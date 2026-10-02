import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Profile } from "./types.ts";

function normalize(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

// Longest matching projectDir wins, so nested profile dirs resolve correctly.
export function resolveProfileForPath(
  target: string,
  profiles: Profile[],
): Profile | undefined {
  const normalizedTarget = normalize(target);
  let best: Profile | undefined;
  let bestLength = -1;

  for (const profile of profiles) {
    if (!profile.projectDir) {
      continue;
    }
    const dir = normalize(profile.projectDir);
    const inside =
      normalizedTarget === dir || normalizedTarget.startsWith(dir + path.sep);
    if (inside && dir.length > bestLength) {
      best = profile;
      bestLength = dir.length;
    }
  }

  return best;
}

export function buildSshUrl(profile: Profile, repoName: string): string {
  return `git@${profile.sshHostAlias}:${profile.githubUsername}/${repoName}.git`;
}

export function repoNameFromUrl(url: string): string | undefined {
  const lastSegment = url.replace(/\/+$/, "").split(/[/:]/).pop();
  return lastSegment?.replace(/\.git$/, "") || undefined;
}

export function getOriginUrl(repoDir: string): string {
  const result = spawnSync(
    "git",
    ["-C", repoDir, "remote", "get-url", "origin"],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : "";
}

export function setOriginUrl(
  repoDir: string,
  url: string,
  hasOrigin: boolean,
): void {
  const result = spawnSync(
    "git",
    ["-C", repoDir, "remote", hasOrigin ? "set-url" : "add", "origin", url],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "git remote command failed.");
  }
}
