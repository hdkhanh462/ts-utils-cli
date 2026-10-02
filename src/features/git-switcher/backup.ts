import fs from "node:fs";
import path from "node:path";
import { logger } from "@/utils/logger.ts";
import { BACKUP_ROOT } from "./constants.ts";
import { logDryRun } from "./helpers.ts";

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

export function backupFiles(filePaths: string[], dryRun: boolean): void {
  const existing = [...new Set(filePaths)].filter((file) =>
    fs.existsSync(file),
  );
  if (existing.length === 0) {
    return;
  }

  const dest = path.join(BACKUP_ROOT, timestamp());

  if (dryRun) {
    logDryRun(`Would back up to ${dest}: ${existing.join(", ")}`);
    return;
  }

  fs.mkdirSync(dest, { recursive: true });
  for (const file of existing) {
    fs.copyFileSync(file, path.join(dest, path.basename(file)));
  }
  logger.info(`Backed up existing config to ${dest}`);
}
