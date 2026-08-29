import os from "node:os";
import path from "node:path";

export const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".dedupe-cache");
export const DEFAULT_CONCURRENCY = os.cpus().length;
