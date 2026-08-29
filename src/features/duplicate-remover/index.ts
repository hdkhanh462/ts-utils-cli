import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runLimited } from "@/utils/concurrency.ts";
import { walkFiles } from "@/utils/fs.ts";
import { logger } from "@/utils/logger.ts";
import { promptYesNo } from "@/utils/prompt.ts";
import { DEFAULT_CACHE_DIR, DEFAULT_CONCURRENCY } from "./constants.ts";
import {
  CacheEntrySchema,
  CliOptionsSchema,
  FolderArgSchema,
} from "./schemas.ts";
import type { Cache, CliOptions } from "./types.ts";

// ================= CONFIG =================

const program = new Command();

program
  .name("duplicate-remover")
  .description("Find and remove duplicate files")
  .argument("<folder>", "target folder")
  .option("-n, --dry-run", "report duplicates without deleting")
  .option(
    "-c, --concurrency <number>",
    "number of parallel jobs",
    (v) => parseInt(v, 10),
    DEFAULT_CONCURRENCY,
  )
  .option("--cache-dir <path>", "cache directory", DEFAULT_CACHE_DIR)
  .option("--no-confirm", "do not prompt before deleting duplicates")
  .option("-v, --verbose", "show verbose output")
  .parse(process.argv);

const folderArgResult = FolderArgSchema.safeParse(program.args[0]);
if (!folderArgResult.success) {
  logger.error(folderArgResult.error.issues[0]?.message);
  program.help();
  process.exit(1);
}
const folder = folderArgResult.data;

const optionsResult = CliOptionsSchema.safeParse(program.opts());
if (!optionsResult.success) {
  logger.error(
    `"${optionsResult.error.issues[0]?.path.join(".")}"`,
    optionsResult.error.issues[0]?.message,
  );
  process.exit(1);
}
const options: CliOptions = optionsResult.data;

const cacheDir = path.resolve(options.cacheDir);
fs.mkdirSync(cacheDir, { recursive: true });

const folderPath = path.resolve(folder);
const normalizedPath = folderPath.toLowerCase();
const folderHash = crypto
  .createHash("md5")
  .update(normalizedPath)
  .digest("hex");

const cacheFilePath = path.join(cacheDir, `${folderHash}.json`);
const concurrency = options.concurrency;
const dryRun = Boolean(options.dryRun);
const confirmDelete = options.confirm !== false;
const verbose = Boolean(options.verbose);

// ================= CACHE =================

let cache: Cache = {};

if (fs.existsSync(cacheFilePath)) {
  try {
    const rawCache = JSON.parse(fs.readFileSync(cacheFilePath, "utf-8"));
    cache = Object.fromEntries(
      Object.entries(rawCache as Record<string, unknown>).map(
        ([key, entry]) => {
          const parsed = CacheEntrySchema.safeParse(entry);
          return [
            path.resolve(key),
            parsed.success ? parsed.data : { size: 0, mtimeMs: 0, hash: "" },
          ];
        },
      ),
    );
  } catch (err) {
    logger.warn("Unable to read cache file, starting fresh:", err);
    cache = {};
  }
}

function saveCache() {
  const tempPath = `${cacheFilePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2));
  fs.renameSync(tempPath, cacheFilePath);
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
      logger.info("Using cached hash for", absolutePath);
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

// ================= CLEAN CACHE =================

function cleanCache(validFiles: string[]) {
  const validSet = new Set(validFiles.map((file) => path.resolve(file)));

  for (const filePath of Object.keys(cache)) {
    if (!validSet.has(path.resolve(filePath))) {
      delete cache[filePath];
    }
  }
}

// ================= MAIN LOGIC =================

async function findDuplicates() {
  const files = await walkFiles(folderPath);

  logger.info("Total files:", files.length);

  const sizeMap = new Map<number, string[]>();

  await Promise.all(
    files.map(async (file) => {
      try {
        const stat = await fs.promises.stat(file);
        if (!sizeMap.has(stat.size)) {
          sizeMap.set(stat.size, []);
        }
        sizeMap.get(stat.size)?.push(file);
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
      hashMap.get(key)?.push(result.file);
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
//#region RUN

async function main() {
  try {
    const stat = await fs.promises.stat(folderPath);
    if (!stat.isDirectory()) {
      throw new Error("Target path is not a folder");
    }
  } catch (_err) {
    logger.error(
      "Target directory does not exist or is not a folder:",
      folderPath,
    );
    process.exit(1);
  }

  const { duplicates, files } = await findDuplicates();

  logger.info("=== RESULT ===");
  logger.info("Duplicate groups:", duplicates.length);

  for (const group of duplicates) {
    logger.info("Duplicate group:");
    group.forEach((file, index) => {
      logger.info(index === 0 ? " Keep:" : " Delete:", file);
    });
  }

  if (dryRun) {
    logger.info("Dry run enabled: no files were deleted.");
  } else if (duplicates.length === 0) {
    logger.info("No duplicate files found. Nothing to delete.");
  } else {
    if (confirmDelete) {
      const confirmed = await promptYesNo(
        "\nConfirm deletion of duplicate files?",
      );
      if (!confirmed) {
        logger.info("Deletion cancelled by user.");
      } else {
        for (const group of duplicates) {
          for (const file of group.slice(1)) {
            try {
              await fs.promises.unlink(file);
              logger.info("Deleted:", file);
            } catch (err) {
              logger.error("Delete failed:", file, err);
            }
          }
        }
      }
    } else {
      for (const group of duplicates) {
        for (const file of group.slice(1)) {
          try {
            await fs.promises.unlink(file);
            logger.info("Deleted:", file);
          } catch (err) {
            logger.error("Delete failed:", file, err);
          }
        }
      }
    }
  }

  cleanCache(files);
  saveCache();

  logger.info("Done!");
}

main().catch((error: Error) => {
  logger.error("Error during duplicate removal:", error.message);
  process.exit(1);
});

//#endregion
