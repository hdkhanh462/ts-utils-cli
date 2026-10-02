import fs from "node:fs";
import path from "node:path";
import { CONFIG_PATH } from "./constants.ts";
import { ConfigSchema } from "./schemas.ts";
import type { Config, Profile } from "./types.ts";

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { profiles: [] };
  }
  return ConfigSchema.parse(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function getProfile(config: Config, id: string): Profile | undefined {
  return config.profiles.find((profile) => profile.id === id);
}

export function upsertProfile(config: Config, profile: Profile): Config {
  const exists = config.profiles.some((p) => p.id === profile.id);
  return {
    profiles: exists
      ? config.profiles.map((p) => (p.id === profile.id ? profile : p))
      : [...config.profiles, profile],
  };
}

export function removeProfile(config: Config, id: string): Config {
  return { profiles: config.profiles.filter((p) => p.id !== id) };
}
