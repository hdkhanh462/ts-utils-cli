import os from "node:os";
import path from "node:path";

export const HOME_DIR = os.homedir();
export const SSH_DIR = path.join(HOME_DIR, ".ssh");
export const SSH_CONFIG_PATH = path.join(SSH_DIR, "config");
export const GIT_CONFIG_PATH = path.join(HOME_DIR, ".gitconfig");

export const DATA_DIR = path.join(HOME_DIR, ".git-switcher");
export const CONFIG_PATH = path.join(DATA_DIR, "config.json");
export const BACKUP_ROOT = path.join(DATA_DIR, "backup");

// Kept identical to the original PowerShell tool so blocks it wrote are
// recognised (updated/removed) instead of duplicated.
export const MARKER_PREFIX = "git-multi-account";

export const DEFAULT_SSH_HOST = "github.com";
