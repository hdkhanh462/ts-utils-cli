// Read/write "marker blocks" inside text files (e.g. ~/.ssh/config,
// ~/.gitconfig) so only the section this tool owns is added/updated/removed,
// leaving anything configured manually untouched.
import { MARKER_PREFIX } from "./constants.ts";
import { logDryRun, readLines, writeLines } from "./helpers.ts";
import type { BlockType } from "./types.ts";

function markers(type: BlockType, profileId: string) {
  const label = `${MARKER_PREFIX}:${type}:${profileId}`;
  return { start: `# >>> ${label} >>>`, end: `# <<< ${label} <<<` };
}

function stripBlock(
  lines: string[],
  start: string,
  end: string,
): { lines: string[]; found: boolean } {
  const kept: string[] = [];
  let inBlock = false;
  let found = false;

  for (const line of lines) {
    if (line === start) {
      inBlock = true;
      found = true;
    } else if (line === end) {
      inBlock = false;
    } else if (!inBlock) {
      kept.push(line);
    }
  }

  return { lines: kept, found };
}

export function hasMarkerBlock(
  filePath: string,
  type: BlockType,
  profileId: string,
): boolean {
  return readLines(filePath).includes(markers(type, profileId).start);
}

export function setMarkerBlock(
  filePath: string,
  type: BlockType,
  profileId: string,
  content: string[],
  dryRun: boolean,
): void {
  const { start, end } = markers(type, profileId);
  const { lines } = stripBlock(readLines(filePath), start, end);

  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(start, ...content, end);

  if (dryRun) {
    const preview = [start, ...content, end].map((l) => `  ${l}`).join("\n");
    logDryRun(
      `Would update block '${type}:${profileId}' in ${filePath}:\n${preview}`,
    );
    return;
  }

  writeLines(filePath, lines);
}

export function removeMarkerBlock(
  filePath: string,
  type: BlockType,
  profileId: string,
  dryRun: boolean,
): boolean {
  const { start, end } = markers(type, profileId);
  const { lines, found } = stripBlock(readLines(filePath), start, end);

  if (!found) {
    return false;
  }

  if (dryRun) {
    logDryRun(`Would remove block '${type}:${profileId}' from ${filePath}`);
    return true;
  }

  writeLines(filePath, lines);
  return true;
}
