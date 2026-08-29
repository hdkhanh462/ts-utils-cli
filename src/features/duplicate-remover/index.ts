import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { Command } from "commander";

// ================= CONFIG =================

const program = new Command();

program
  .name("dedupe")
  .description("Find and remove duplicate files")
  .option("-d, --dir <path>", "target folder", "./test-folder")
  .option("-n, --dry-run", "report duplicates without deleting")
  .option(
    "-c, --concurrency <number>",
    "number of parallel jobs",
    (v) => parseInt(v, 10),
    os.cpus().length,
  )
  .option(
    "--cache-dir <path>",
    "cache directory",
    path.join(os.homedir(), ".dedupe-cache"),
  )
  .option("--no-confirm", "do not prompt before deleting duplicates")
  .option("-v, --verbose", "show verbose output")
  .parse(process.argv);

const options = program.opts<{
  dir: string;
  dryRun?: boolean;
  concurrency: number;
  cacheDir: string;
  confirm?: boolean;
  verbose?: boolean;
}>();

const cacheDir = path.resolve(options.cacheDir);
fs.mkdirSync(cacheDir, { recursive: true });

const folderPath = path.resolve(options.dir);
const normalizedPath = folderPath.toLowerCase();
const folderHash = crypto
  .createHash("md5")
  .update(normalizedPath)
  .digest("hex");

const cacheFilePath = path.join(cacheDir, `${folderHash}.json`);
const concurrency = Number.isFinite(options.concurrency)
  ? Math.max(1, options.concurrency)
  : os.cpus().length;
const dryRun = Boolean(options.dryRun);
const confirmDelete = options.confirm !== false;
const verbose = Boolean(options.verbose);

// ================= CACHE =================

type CacheEntry = {
  size: number;
  mtimeMs: number;
  hash: string;
};

let cache: Record<string, CacheEntry> = {};

if (fs.existsSync(cacheFilePath)) {
  try {
    const rawCache = JSON.parse(fs.readFileSync(cacheFilePath, "utf-8"));
    cache = Object.fromEntries(
      Object.entries(rawCache as Record<string, unknown>).map(
        ([key, entry]) => {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as any).size === "number" &&
            typeof (entry as any).mtimeMs === "number" &&
            typeof (entry as any).hash === "string"
          ) {
            return [path.resolve(key), entry as CacheEntry];
          }

          return [
            path.resolve(key),
            { size: 0, mtimeMs: 0, hash: "" } as CacheEntry,
          ];
        },
      ),
    );
  } catch (err) {
    console.warn("Unable to read cache file, starting fresh:", err);
    cache = {};
  }
}

function saveCache() {
  const tempPath = `${cacheFilePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2));
  fs.renameSync(tempPath, cacheFilePath);
}

// ================= SCAN =================

async function getAllFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      try {
        if (entry.isDirectory()) {
          const nested = await getAllFiles(fullPath);
          results.push(...nested);
        } else if (entry.isFile()) {
          results.push(fullPath);
        } else if (entry.isSymbolicLink()) {
          const stat = await fs.promises.stat(fullPath).catch(() => null);
          if (stat?.isFile()) {
            results.push(fullPath);
          }
        }
      } catch {
        // skip unreadable items
      }
    }),
  );

  return results;
}

// ================= HASH =================

function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function getFileHashWithCache(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.promises.stat(absolutePath);
  const cached = cache[absolutePath];

  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    if (verbose) {
      console.log("Using cached hash for", absolutePath);
    }
    return cached.hash;
  }

  const hash = await getFileHash(absolutePath);

  cache[absolutePath] = {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    hash,
  };

  return hash;
}

// ================= CONCURRENCY =================

async function runLimited<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<(T | undefined)[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: (T | undefined)[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= tasks.length) {
        break;
      }

      const task = tasks[current];
      if (!task) {
        continue;
      }

      try {
        results[current] = await task();
      } catch (err) {
        console.error(`Task ${current} failed:`, err);
        results[current] = undefined;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ================= CLEAN CACHE =================

function cleanCache(validFiles: string[]) {
  const validSet = new Set(validFiles.map((file) => path.resolve(file)));

  for (const filePath of Object.keys(cache)) {
    if (!validSet.has(path.resolve(filePath))) {
      delete cache[filePath];
    }
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  const fr = await import("readline");
  const rl = fr.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

// ================= MAIN LOGIC =================

async function findDuplicates() {
  const files = await getAllFiles(folderPath);

  console.log("Total files:", files.length);

  const sizeMap = new Map<number, string[]>();

  await Promise.all(
    files.map(async (file) => {
      try {
        const stat = await fs.promises.stat(file);
        if (!sizeMap.has(stat.size)) {
          sizeMap.set(stat.size, []);
        }
        sizeMap.get(stat.size)!.push(file);
      } catch {
        // ignore file access errors
      }
    }),
  );

  const duplicates: string[][] = [];

  for (const sameSizeFiles of sizeMap.values()) {
    if (sameSizeFiles.length < 2) {
      continue;
    }

    const tasks = sameSizeFiles.map((file) => async () => {
      const hash = await getFileHashWithCache(file);
      return { file, hash };
    });

    const results = await runLimited(tasks, concurrency);

    const hashMap = new Map<string, string[]>();

    for (const result of results) {
      if (!result) {
        continue;
      }

      const key = result.hash;
      if (!hashMap.has(key)) {
        hashMap.set(key, []);
      }
      hashMap.get(key)!.push(result.file);
    }

    for (const group of hashMap.values()) {
      if (group.length > 1) {
        group.sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" }),
        );
        duplicates.push(group);
      }
    }
  }

  return { duplicates, files };
}

// ================= RUN =================

async function main() {
  try {
    const stat = await fs.promises.stat(folderPath);
    if (!stat.isDirectory()) {
      throw new Error("Target path is not a folder");
    }
  } catch (err) {
    console.error(
      "Target directory does not exist or is not a folder:",
      folderPath,
    );
    process.exit(1);
  }

  const { duplicates, files } = await findDuplicates();

  console.log("\n=== RESULT ===");
  console.log("Duplicate groups:", duplicates.length);

  for (const group of duplicates) {
    console.log("\nDuplicate group:");
    group.forEach((file, index) => {
      console.log(index === 0 ? " Keep:" : " Delete:", file);
    });
  }

  if (dryRun) {
    console.log("\nDry run enabled: no files were deleted.");
  } else if (duplicates.length === 0) {
    console.log("\nNo duplicate files found. Nothing to delete.");
  } else {
    if (confirmDelete) {
      const confirmed = await promptYesNo(
        "\nConfirm deletion of duplicate files?",
      );
      if (!confirmed) {
        console.log("Deletion cancelled by user.");
      } else {
        for (const group of duplicates) {
          for (const file of group.slice(1)) {
            try {
              await fs.promises.unlink(file);
              console.log("Deleted:", file);
            } catch (err) {
              console.error("Delete failed:", file, err);
            }
          }
        }
      }
    } else {
      for (const group of duplicates) {
        for (const file of group.slice(1)) {
          try {
            await fs.promises.unlink(file);
            console.log("Deleted:", file);
          } catch (err) {
            console.error("Delete failed:", file, err);
          }
        }
      }
    }
  }

  cleanCache(files);
  saveCache();

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
