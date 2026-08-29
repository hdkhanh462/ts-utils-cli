import { z } from "zod";
import { DEFAULT_CONCURRENCY } from "./constants.ts";

export const CliOptionsSchema = z.object({
  dir: z.string().min(1),
  dryRun: z.boolean().optional(),
  concurrency: z.preprocess((value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : DEFAULT_CONCURRENCY;
  }, z.number().int().min(1)),
  cacheDir: z.string().min(1),
  confirm: z.boolean().optional(),
  verbose: z.boolean().optional(),
});

export const CacheEntrySchema = z.object({
  size: z.number(),
  mtimeMs: z.number(),
  hash: z.string(),
});

export const CacheFileSchema = z.record(z.string(), CacheEntrySchema);
