import type { z } from "zod";
import type { ConfigSchema, ProfileSchema } from "./schemas.ts";

export type Profile = z.infer<typeof ProfileSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export type BlockType = "ssh" | "includeif";

export type CliOptions = {
  dryRun?: boolean;
};
