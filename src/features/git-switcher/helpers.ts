import fs from "node:fs";
import path from "node:path";
import { logger } from "@/utils/logger.ts";

export function logDryRun(message: string): void {
  logger.info("[dry-run]", message);
}

export function readLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

// UTF-8 without BOM: OpenSSH's config parser rejects a leading BOM.
export function writeLines(filePath: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = lines.join("\n");
  fs.writeFileSync(
    filePath,
    content.endsWith("\n") ? content : `${content}\n`,
    "utf8",
  );
}

export function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}
