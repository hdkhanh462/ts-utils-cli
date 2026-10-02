import { z } from "zod";

export const ProfileSchema = z.object({
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "Profile id may only contain letters, digits, '_' and '-'.",
    ),
  gitName: z.string().min(1),
  gitEmail: z.string().min(1),
  githubUsername: z.string().min(1),
  sshKeyFile: z.string().min(1),
  sshHostAlias: z.string().min(1),
  projectDir: z.string(),
});

export const ConfigSchema = z.object({
  profiles: z.array(ProfileSchema).default([]),
});

export const CliOptionsSchema = z.object({
  dryRun: z.boolean().optional(),
});

export const ProfileIdArgSchema = z
  .string()
  .min(1, "Please specify a profile id.");

export const PathArgSchema = z
  .string()
  .min(1, "Please specify a repository folder.");
