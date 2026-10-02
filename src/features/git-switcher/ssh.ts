import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/utils/logger.ts";
import { SSH_DIR } from "./constants.ts";
import { logDryRun } from "./helpers.ts";

const isWindows = process.platform === "win32";

export function privateKeyPath(keyFile: string): string {
  return path.join(SSH_DIR, keyFile);
}

export function publicKeyPath(keyFile: string): string {
  return `${privateKeyPath(keyFile)}.pub`;
}

export function createKeyIfMissing(
  keyFile: string,
  email: string,
  dryRun: boolean,
): void {
  const keyPath = privateKeyPath(keyFile);

  if (fs.existsSync(keyPath)) {
    logger.info(`SSH key already exists: ${keyPath}`);
    return;
  }

  if (dryRun) {
    logDryRun(`Would create new SSH key: ${keyPath}`);
    return;
  }

  fs.mkdirSync(SSH_DIR, { recursive: true });

  // stdio is inherited so ssh-keygen can prompt for a passphrase.
  const result = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-C", email, "-f", keyPath],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`ssh-keygen failed for key: ${keyPath}`);
  }
}

// Equivalent of `chmod 600` on Windows, otherwise ssh may refuse the key.
export function restrictKeyPermissions(keyFile: string, dryRun: boolean): void {
  const keyPath = privateKeyPath(keyFile);
  if (!isWindows || !fs.existsSync(keyPath)) {
    return;
  }

  if (dryRun) {
    logDryRun(`Would restrict file permissions on: ${keyPath}`);
    return;
  }

  const user = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`;
  for (const args of [
    ["/inheritance:r"],
    ["/grant:r", `${user}:(R)`],
    ["/grant:r", "SYSTEM:(F)"],
    ["/grant:r", "*S-1-5-32-544:(F)"],
  ]) {
    spawnSync("icacls", [keyPath, ...args], { stdio: "ignore" });
  }
}

function isAdmin(): boolean {
  return spawnSync("net", ["session"], { stdio: "ignore" }).status === 0;
}

export function enableSshAgent(dryRun: boolean): boolean {
  if (!isWindows) {
    return true;
  }

  const query = spawnSync("sc", ["query", "ssh-agent"], { encoding: "utf8" });
  if (query.status !== 0) {
    logger.warn(
      "Service 'ssh-agent' not found. Install the 'OpenSSH Client' Windows optional feature to use ssh-agent.",
    );
    return false;
  }

  if (dryRun) {
    logDryRun(
      "Would ensure the ssh-agent service is running (automatic startup)",
    );
    return true;
  }

  if (!isAdmin()) {
    logger.warn(
      "Not running as Administrator - skipping ssh-agent service setup. Re-run as Administrator to configure it automatically, or start it yourself.",
    );
    return false;
  }

  spawnSync("sc", ["config", "ssh-agent", "start=", "auto"], {
    stdio: "ignore",
  });
  if (!/RUNNING/.test(query.stdout)) {
    const start = spawnSync("sc", ["start", "ssh-agent"], { encoding: "utf8" });
    if (start.status !== 0) {
      logger.warn(
        `Could not start the ssh-agent service: ${start.stdout.trim()}`,
      );
      return false;
    }
  }
  return true;
}

export function addKeyToAgent(keyFile: string, dryRun: boolean): void {
  const keyPath = privateKeyPath(keyFile);
  if (!fs.existsSync(keyPath)) {
    return;
  }

  if (dryRun) {
    logDryRun(`Would run: ssh-add ${keyPath}`);
    return;
  }

  spawnSync("ssh-add", [keyPath], { stdio: "inherit" });
}

export function testSshHost(alias: string): { ok: boolean; output: string } {
  // GitHub prints its auth message to stderr and exits non-zero (no shell),
  // so success is detected from the text rather than the exit code.
  const result = spawnSync("ssh", ["-T", alias], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: /successfully authenticated/.test(output), output };
}
