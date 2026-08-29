import fs from "node:fs";
import path from "node:path";

export async function walkFiles(dir: string): Promise<string[]> {
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
          const nested = await walkFiles(fullPath);
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
