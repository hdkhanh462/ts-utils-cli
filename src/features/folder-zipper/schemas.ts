import { z } from "zod";

export const FolderArgSchema = z
  .string()
  .min(1, "Please specify a folder to compress.");

export const CliOptionsSchema = z.object({
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  output: z.string().optional(),
  delete: z.boolean().optional(),
  maxParts: z
    .number()
    .int("--max-parts must be a positive integer.")
    .positive("--max-parts must be a positive integer.")
    .optional(),
  oversizedDir: z.string().min(1).optional(),
});
