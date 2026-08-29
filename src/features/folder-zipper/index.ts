import { Command } from "commander";
import { ZipArchive } from "archiver";
import fs from "fs";
import path from "path";

const BYTES_IN_MB = 1024 ** 2;
const MAX_FILE_SIZE_BYTES = 200 * BYTES_IN_MB;
const TARGET_MIN_BYTES = 500 * BYTES_IN_MB;
const TARGET_MAX_BYTES = 550 * BYTES_IN_MB;

type FileEntry = {
  fullPath: string;
  relativePath: string;
  size: number;
};

function getCurrentDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

function formatSize(bytes: number): string {
  if (bytes >= BYTES_IN_MB) {
    return `${(bytes / BYTES_IN_MB).toFixed(2)} MB`;
  }
  return `${bytes.toLocaleString()} bytes`;
}

async function collectFiles(
  sourceDir: string,
  baseDir = sourceDir,
): Promise<FileEntry[]> {
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  const files: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(sourceDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, baseDir)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stats = await fs.promises.stat(fullPath);
    files.push({
      fullPath,
      relativePath: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
      size: stats.size,
    });
  }

  return files;
}

function chooseFiles(files: FileEntry[]): FileEntry[] {
  const candidates = files.filter((file) => file.size < MAX_FILE_SIZE_BYTES);
  const sortedDesc = [...candidates].sort((a, b) => b.size - a.size);
  const selected = new Set<FileEntry>();
  let totalSize = 0;

  for (const file of sortedDesc) {
    if (totalSize + file.size <= TARGET_MAX_BYTES) {
      selected.add(file);
      totalSize += file.size;
    }
  }

  if (totalSize < TARGET_MIN_BYTES) {
    const sortedAsc = [...candidates].sort((a, b) => a.size - b.size);
    for (const file of sortedAsc) {
      if (selected.has(file)) {
        continue;
      }

      if (totalSize + file.size <= TARGET_MAX_BYTES) {
        selected.add(file);
        totalSize += file.size;
      }

      if (totalSize >= TARGET_MIN_BYTES) {
        break;
      }
    }
  }

  return [...selected].sort((a, b) => a.size - b.size);
}

async function moveFileToTemp(
  file: FileEntry,
  tempRoot: string,
): Promise<void> {
  const targetPath = path.join(tempRoot, file.relativePath);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    await fs.promises.rename(file.fullPath, targetPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      await fs.promises.copyFile(file.fullPath, targetPath);
      await fs.promises.unlink(file.fullPath);
    } else {
      throw err;
    }
  }
}

async function moveSelectedFilesToTemp(
  selectedFiles: FileEntry[],
  tempRoot: string,
): Promise<void> {
  await Promise.all(
    selectedFiles.map((file) => moveFileToTemp(file, tempRoot)),
  );
}

async function deleteSelectedFiles(selectedFiles: FileEntry[]): Promise<void> {
  await Promise.all(
    selectedFiles.map((file) => fs.promises.unlink(file.fullPath)),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBundles(
  files: FileEntry[],
  maxParts?: number,
): {
  bundles: FileEntry[][];
  stoppedByMaxParts: boolean;
  remainingFiles: FileEntry[];
} {
  const bundles: FileEntry[][] = [];
  let remainingFiles = [...files];
  let stoppedByMaxParts = false;

  while (true) {
    if (typeof maxParts === "number" && bundles.length >= maxParts) {
      stoppedByMaxParts = true;
      break;
    }

    const bundle = chooseFiles(remainingFiles);
    const bundleSize = bundle.reduce((sum, file) => sum + file.size, 0);

    if (bundle.length === 0 || bundleSize < TARGET_MIN_BYTES) {
      break;
    }

    bundles.push(bundle);

    const selectedPaths = new Set(bundle.map((file) => file.fullPath));
    remainingFiles = remainingFiles.filter(
      (file) => !selectedPaths.has(file.fullPath),
    );

    if (remainingFiles.length === 0) {
      break;
    }

    const remainingTotal = remainingFiles.reduce(
      (sum, file) => sum + file.size,
      0,
    );

    if (remainingTotal < TARGET_MIN_BYTES) {
      break;
    }
  }

  return { bundles, stoppedByMaxParts, remainingFiles };
}

async function getNextPartIndex(
  outputDir: string,
  zipNameBase: string,
): Promise<{
  startIndex: number;
  hasExistingParts: boolean;
  hasBaseFile: boolean;
}> {
  const entries = await fs.promises.readdir(outputDir, { withFileTypes: true });
  const regex = new RegExp(`^${escapeRegExp(zipNameBase)}_part(\\d+)\\.zip$`);
  let maxPart = 0;
  let hasBaseFile = false;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === `${zipNameBase}.zip`) {
      hasBaseFile = true;
    }

    const match = regex.exec(entry.name);
    if (match && match[1]) {
      const partNumber = parseInt(match[1], 10);
      if (!Number.isNaN(partNumber)) {
        maxPart = Math.max(maxPart, partNumber);
      }
    }
  }

  return {
    startIndex: maxPart > 0 ? maxPart + 1 : 1,
    hasExistingParts: maxPart > 0,
    hasBaseFile,
  };
}

async function createZipArchive(
  selectedFiles: FileEntry[],
  outputFile: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outputFile);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => {
      const finalSize = fs.statSync(outputFile).size;
      console.log(`Created ${outputFile} (${formatSize(finalSize)}).`);
      resolve();
    });

    archive.on("warning", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        reject(err);
      }
    });

    archive.on("error", reject);
    archive.pipe(output);

    for (const file of selectedFiles) {
      archive.file(file.fullPath, { name: file.relativePath });
    }

    archive.finalize();
  });
}

export async function zipDirectory(
  sourceDir: string,
  outputFile: string,
  options: { deleteOriginal?: boolean; maxParts?: number } = {},
): Promise<void> {
  const allFiles = await collectFiles(sourceDir);

  if (allFiles.length === 0) {
    throw new Error(`No files found in folder: ${sourceDir}`);
  }

  const skippedFiles = allFiles.filter(
    (file) => file.size >= MAX_FILE_SIZE_BYTES,
  );
  const eligibleFiles = allFiles.filter(
    (file) => file.size < MAX_FILE_SIZE_BYTES,
  );

  if (eligibleFiles.length === 0) {
    throw new Error(
      `No files smaller than ${formatSize(MAX_FILE_SIZE_BYTES)} were found in ${sourceDir}. ` +
        "Nothing to compress.",
    );
  }

  const { bundles, stoppedByMaxParts, remainingFiles } = buildBundles(
    eligibleFiles,
    options.maxParts,
  );

  if (bundles.length === 0) {
    throw new Error(
      `Remaining eligible files do not reach the minimum target size of ${formatSize(TARGET_MIN_BYTES)}.`,
    );
  }

  console.log(
    `Found ${eligibleFiles.length} eligible file(s) and ${skippedFiles.length} skipped file(s) >= ${formatSize(MAX_FILE_SIZE_BYTES)}.\n`,
  );

  const zipNameBase = path.basename(outputFile, ".zip");
  const outputDir = path.dirname(outputFile);
  const { startIndex, hasExistingParts, hasBaseFile } = await getNextPartIndex(
    outputDir,
    zipNameBase,
  );
  let partIndex = startIndex;
  const runBundleCount = bundles.length;
  const usePartSuffix = hasExistingParts || hasBaseFile || bundles.length > 1;

  for (let bundleIndex = 0; bundleIndex < bundles.length; bundleIndex += 1) {
    const bundle = bundles[bundleIndex]!;
    const partSuffix = usePartSuffix ? `_part${partIndex}` : "";
    const bundleZipFile = path.join(
      outputDir,
      `${zipNameBase}${partSuffix}.zip`,
    );
    const bundleSize = bundle.reduce((sum, file) => sum + file.size, 0);

    console.log(
      `Creating bundle ${bundleIndex + 1}/${runBundleCount} with ${bundle.length} file(s), total original size: ${formatSize(bundleSize)}.`,
    );

    await createZipArchive(bundle, bundleZipFile);

    if (options.deleteOriginal) {
      await deleteSelectedFiles(bundle);
      console.log("Deleted original files after compression.\n");
    } else {
      const tempDirName = `${zipNameBase}${partSuffix}`;
      const tempRoot = path.join(outputDir, tempDirName);
      await moveSelectedFilesToTemp(bundle, tempRoot);
      console.log(`Moved original files into temp folder ${tempRoot}.\n`);
    }

    partIndex += 1;
  }

  if (skippedFiles.length > 0) {
    console.log(
      `Skipped ${skippedFiles.length} large file(s) >= ${formatSize(MAX_FILE_SIZE_BYTES)} (200 MB).`,
    );
  }

  const usedFilesCount = bundles.flat().length;
  const remainingFilesCount = eligibleFiles.length - usedFilesCount;
  if (remainingFilesCount > 0) {
    if (options.maxParts && stoppedByMaxParts) {
      console.warn(
        `Warning: maxParts=${options.maxParts} was reached and ${remainingFilesCount} eligible file(s) remain uncompressed.`,
      );
    } else {
      console.log(
        `Left ${remainingFilesCount} eligible file(s) uncompressed because remaining total did not meet the minimum ${formatSize(TARGET_MIN_BYTES)}.`,
      );
    }
  }
}

const program = new Command();

program
  .name("folder-zipper")
  .argument("<folder>", "Folder to compress")
  .option("-p, --prefix <prefix>", "File name prefix", "")
  .option("-s, --suffix <suffix>", "File name suffix", `_${getCurrentDate()}`)
  .option("-o, --output <dir>", "Output directory for zip file")
  .option(
    "-d, --delete",
    "Delete original files after compression instead of moving them to temp",
  )
  .option(
    "-m, --max-parts <number>",
    "Maximum number of zip files to create",
    (value) => parseInt(value, 10),
  )
  .parse();

type CLIOptions = {
  prefix?: string;
  suffix?: string;
  output?: string;
  delete?: boolean;
  maxParts?: number;
};

const folder = program.args[0];
const options = program.opts<CLIOptions>();

if (
  options.maxParts != null &&
  (Number.isNaN(options.maxParts) || options.maxParts <= 0)
) {
  console.error("❌ --max-parts must be a positive integer.");
  process.exit(1);
}

if (!folder) {
  console.error("❌ Please specify a folder to compress.");
  program.help();
  process.exit(1);
}

const sourceDir = path.resolve(folder);

if (!fs.existsSync(sourceDir)) {
  console.error(`❌ Folder not found: ${sourceDir}`);
  process.exit(1);
}

const folderName = path.basename(sourceDir);
const zipFileName = `${options.prefix}${folderName}${options.suffix}.zip`;

const outputDir = options.output
  ? path.resolve(options.output)
  : path.dirname(sourceDir);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputFile = path.join(outputDir, zipFileName);

await zipDirectory(sourceDir, outputFile, {
  deleteOriginal: options.delete,
  maxParts: options.maxParts,
});
