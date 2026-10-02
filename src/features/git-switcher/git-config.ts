import path from "node:path";
import { GIT_CONFIG_PATH, HOME_DIR } from "./constants.ts";
import { logDryRun, toForwardSlashes, writeLines } from "./helpers.ts";
import { setMarkerBlock } from "./marker-block.ts";
import type { Profile } from "./types.ts";

export function identityFilePath(profileId: string): string {
  return path.join(HOME_DIR, `.gitconfig-${profileId}`);
}

export function writeIdentityFile(profile: Profile, dryRun: boolean): void {
  const filePath = identityFilePath(profile.id);
  const content = [
    "[user]",
    `    name = ${profile.gitName}`,
    `    email = ${profile.gitEmail}`,
  ];

  if (dryRun) {
    logDryRun(
      `Would write identity file ${filePath}:\n${content.map((l) => `  ${l}`).join("\n")}`,
    );
    return;
  }

  writeLines(filePath, content);
}

// Makes every repo under projectDir pick up this profile's identity.
export function writeIncludeIf(profile: Profile, dryRun: boolean): void {
  const gitdir = `${toForwardSlashes(profile.projectDir).replace(/\/+$/, "")}/`;
  setMarkerBlock(
    GIT_CONFIG_PATH,
    "includeif",
    profile.id,
    [
      `[includeIf "gitdir:${gitdir}"]`,
      `    path = ${toForwardSlashes(identityFilePath(profile.id))}`,
    ],
    dryRun,
  );
}
