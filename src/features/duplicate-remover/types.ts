export type CacheEntry = {
  size: number;
  mtimeMs: number;
  hash: string;
};

export type Cache = Record<string, CacheEntry>;

export type CliOptions = {
  dryRun?: boolean;
  concurrency: number;
  cacheDir: string;
  confirm?: boolean;
  verbose?: boolean;
};
