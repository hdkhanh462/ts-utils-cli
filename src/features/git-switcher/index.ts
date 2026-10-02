#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { logger } from "@/utils/logger.ts";
import { promptInput, promptYesNo } from "@/utils/prompt.ts";
import { breakLine } from "@/utils/string.ts";
import { backupFiles } from "./backup.ts";
import {
  getProfile,
  loadConfig,
  removeProfile,
  saveConfig,
  upsertProfile,
} from "./config.ts";
import {
  DEFAULT_SSH_HOST,
  GIT_CONFIG_PATH,
  SSH_CONFIG_PATH,
} from "./constants.ts";
import {
  identityFilePath,
  writeIdentityFile,
  writeIncludeIf,
} from "./git-config.ts";
import { logDryRun } from "./helpers.ts";
import {
  hasMarkerBlock,
  removeMarkerBlock,
  setMarkerBlock,
} from "./marker-block.ts";
import {
  buildSshUrl,
  getOriginUrl,
  repoNameFromUrl,
  resolveProfileForPath,
  setOriginUrl,
} from "./remote.ts";
import {
  CliOptionsSchema,
  PathArgSchema,
  ProfileIdArgSchema,
  ProfileSchema,
} from "./schemas.ts";
import {
  addKeyToAgent,
  createKeyIfMissing,
  enableSshAgent,
  privateKeyPath,
  publicKeyPath,
  restrictKeyPermissions,
  testSshHost,
} from "./ssh.ts";
import type { CliOptions, Profile } from "./types.ts";

async function promptRequired(
  question: string,
  defaultValue = "",
): Promise<string> {
  while (true) {
    const answer = await promptInput(question, defaultValue);
    if (answer) {
      return answer;
    }
    logger.warn("This value cannot be empty.");
  }
}

async function promptProfile(
  existingProfiles: Profile[],
  isFirst: boolean,
): Promise<Profile> {
  let id = await promptRequired("Profile id (e.g. personal, work)");
  while (!ProfileSchema.shape.id.safeParse(id).success) {
    logger.warn("Profile id may only contain letters, digits, '_' and '-'.");
    id = await promptRequired("Profile id (e.g. personal, work)");
  }

  const existing = existingProfiles.find((p) => p.id === id);
  if (existing) {
    logger.info(
      `Profile '${id}' already exists, its current values are used as defaults.`,
    );
  }

  const gitName = await promptRequired("Git user.name", existing?.gitName);
  const gitEmail = await promptRequired("Git user.email", existing?.gitEmail);
  const githubUsername = await promptRequired(
    "GitHub username",
    existing?.githubUsername,
  );
  const sshKeyFile = await promptRequired(
    "SSH key file name (inside ~/.ssh)",
    existing?.sshKeyFile ?? `id_ed25519_${id}`,
  );
  const sshHostAlias = await promptRequired(
    "SSH host alias (used in git remote / ~/.ssh/config)",
    existing?.sshHostAlias ?? (isFirst ? DEFAULT_SSH_HOST : `github-${id}`),
  );
  const projectDir = await promptRequired(
    "Project directory for this profile",
    existing?.projectDir,
  );

  const normalizedDir = path.resolve(projectDir).toLowerCase();
  for (const other of existingProfiles) {
    if (
      other.id !== id &&
      other.projectDir &&
      path.resolve(other.projectDir).toLowerCase() === normalizedDir
    ) {
      logger.warn(
        `Directory '${projectDir}' is already used by profile '${other.id}'.`,
      );
    }
  }

  return {
    id,
    gitName,
    gitEmail,
    githubUsername,
    sshKeyFile,
    sshHostAlias,
    projectDir,
  };
}

function applyProfile(profile: Profile, dryRun: boolean): void {
  logger.info(`Applying profile '${profile.id}'`);

  createKeyIfMissing(profile.sshKeyFile, profile.gitEmail, dryRun);
  restrictKeyPermissions(profile.sshKeyFile, dryRun);

  setMarkerBlock(
    SSH_CONFIG_PATH,
    "ssh",
    profile.id,
    [
      `Host ${profile.sshHostAlias}`,
      "    HostName github.com",
      "    User git",
      `    IdentityFile ~/.ssh/${profile.sshKeyFile}`,
      "    IdentitiesOnly yes",
    ],
    dryRun,
  );

  writeIdentityFile(profile, dryRun);
  writeIncludeIf(profile, dryRun);
}

// ================= COMMANDS =================

async function setup({ dryRun = false }: CliOptions): Promise<void> {
  let config = loadConfig();
  const touched: Profile[] = [];

  let addMore = true;
  while (addMore) {
    breakLine();
    logger.info(`Profile #${touched.length + 1}`);

    const profile = await promptProfile(
      config.profiles,
      config.profiles.length === 0 && touched.length === 0,
    );
    config = upsertProfile(config, profile);
    touched.push(profile);

    addMore = await promptYesNo("Add another profile?");
  }

  breakLine();
  backupFiles(
    [
      GIT_CONFIG_PATH,
      SSH_CONFIG_PATH,
      ...config.profiles.map((p) => identityFilePath(p.id)),
    ],
    dryRun,
  );

  for (const profile of touched) {
    applyProfile(profile, dryRun);
  }

  breakLine();
  logger.info("Configuring ssh-agent");
  if (enableSshAgent(dryRun)) {
    for (const profile of touched) {
      addKeyToAgent(profile.sshKeyFile, dryRun);
    }
  }

  if (dryRun) {
    logDryRun("Would save profiles to the git-switcher config.");
  } else {
    saveConfig(config);
  }

  breakLine();
  logger.info("Testing SSH");
  for (const profile of touched) {
    if (dryRun) {
      logDryRun(`Would run: ssh -T ${profile.sshHostAlias}`);
      continue;
    }

    const { ok, output } = testSshHost(profile.sshHostAlias);
    if (ok) {
      logger.info(`${profile.sshHostAlias}: ${output}`);
    } else {
      logger.warn(
        `${profile.sshHostAlias}: did not find 'successfully authenticated'. Output: ${output}`,
      );
      logger.warn(
        "Make sure the public key below has been added to GitHub, then try again.",
      );
    }
  }

  breakLine();
  logger.info("Public keys (GitHub -> Settings -> SSH and GPG keys)");
  for (const profile of touched) {
    breakLine();
    logger.info(`[${profile.id}] ${profile.githubUsername}`);
    const pubPath = publicKeyPath(profile.sshKeyFile);
    if (fs.existsSync(pubPath)) {
      console.log(fs.readFileSync(pubPath, "utf8").trim());
    } else {
      logger.warn("Not created yet, re-run without --dry-run to generate it.");
    }
  }
}

function show(): void {
  const { profiles } = loadConfig();
  if (profiles.length === 0) {
    logger.warn("No profiles yet. Run: git-switcher setup");
    return;
  }

  for (const p of profiles) {
    const keyPresent = fs.existsSync(privateKeyPath(p.sshKeyFile));
    const sshOk = hasMarkerBlock(SSH_CONFIG_PATH, "ssh", p.id);
    const includeOk = hasMarkerBlock(GIT_CONFIG_PATH, "includeif", p.id);

    breakLine();
    logger.info(`Profile: ${p.id}`);
    console.log(`  Git name        : ${p.gitName}`);
    console.log(`  Git email       : ${p.gitEmail}`);
    console.log(`  GitHub username : ${p.githubUsername}`);
    console.log(`  SSH key file    : ${p.sshKeyFile}`);
    console.log(`  SSH host alias  : ${p.sshHostAlias}`);
    console.log(`  Project dir     : ${p.projectDir}`);
    console.log(`  SSH key         : ${keyPresent ? "present" : "MISSING"}`);
    console.log(
      `  ~/.ssh/config   : ${sshOk ? "block present" : "BLOCK MISSING"}`,
    );
    console.log(
      `  ~/.gitconfig    : ${includeOk ? "includeIf present" : "INCLUDEIF MISSING"}`,
    );
  }
}

async function repair(
  repoArg: string,
  { dryRun = false }: CliOptions,
): Promise<void> {
  const repoDir = path.resolve(repoArg);
  if (!fs.existsSync(repoDir)) {
    throw new Error(`Directory not found: ${repoDir}`);
  }
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    throw new Error(`Not a git repository: ${repoDir}`);
  }

  const profile = resolveProfileForPath(repoDir, loadConfig().profiles);
  if (!profile) {
    throw new Error(
      "No profile found whose project directory contains this folder. Run 'git-switcher show' to see the profiles.",
    );
  }

  const currentOrigin = getOriginUrl(repoDir);
  const repoName = repoNameFromUrl(currentOrigin) ?? path.basename(repoDir);
  const newUrl = buildSshUrl(profile, repoName);

  logger.info(`Repairing remote for: ${repoDir}`);
  console.log(`  Profile    : ${profile.id}`);
  console.log(`  Old origin : ${currentOrigin || "(none)"}`);
  console.log(`  New origin : ${newUrl}`);

  if (currentOrigin === newUrl) {
    logger.info("Remote is already correct, nothing to change.");
    return;
  }

  if (dryRun) {
    logDryRun(`Would ${currentOrigin ? "set-url" : "add"} origin to ${newUrl}`);
    return;
  }

  if (!(await promptYesNo("Confirm updating the origin remote?", true))) {
    logger.info("Cancelled.");
    return;
  }

  setOriginUrl(repoDir, newUrl, Boolean(currentOrigin));
  logger.info("Origin remote updated.");
}

async function uninstall(
  profileId: string,
  { dryRun = false }: CliOptions,
): Promise<void> {
  const config = loadConfig();
  const profile = getProfile(config, profileId);
  if (!profile) {
    throw new Error(`Profile '${profileId}' not found.`);
  }

  logger.info(`Removing profile '${profileId}'`);
  backupFiles([GIT_CONFIG_PATH, SSH_CONFIG_PATH], dryRun);

  removeMarkerBlock(SSH_CONFIG_PATH, "ssh", profileId, dryRun);
  removeMarkerBlock(GIT_CONFIG_PATH, "includeif", profileId, dryRun);

  const identityFile = identityFilePath(profileId);
  if (fs.existsSync(identityFile)) {
    if (dryRun) {
      logDryRun(`Would delete file: ${identityFile}`);
    } else if (
      await promptYesNo(`Delete identity file '${identityFile}'?`, true)
    ) {
      fs.rmSync(identityFile, { force: true });
    }
  }

  const keyPath = privateKeyPath(profile.sshKeyFile);
  if (
    !dryRun &&
    fs.existsSync(keyPath) &&
    (await promptYesNo(
      `Also delete the physical SSH key '${keyPath}' and its .pub file?`,
    ))
  ) {
    fs.rmSync(keyPath, { force: true });
    fs.rmSync(publicKeyPath(profile.sshKeyFile), { force: true });
  }

  if (!dryRun) {
    saveConfig(removeProfile(config, profileId));
  }

  logger.info(`Profile '${profileId}' removed from ssh config / gitconfig.`);
}

// ================= CLI =================

function parseOptions(raw: unknown): CliOptions {
  const result = CliOptionsSchema.safeParse(raw);
  if (!result.success) {
    logger.error(
      `"${result.error.issues[0]?.path.join(".")}"`,
      result.error.issues[0]?.message,
    );
    process.exit(1);
  }
  return result.data;
}

function parseArg(
  schema: typeof ProfileIdArgSchema | typeof PathArgSchema,
  value: string | undefined,
): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    logger.error(result.error.issues[0]?.message);
    process.exit(1);
  }
  return result.data;
}

async function run(task: () => Promise<void> | void): Promise<void> {
  try {
    await task();
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }
}

const program = new Command();

program
  .name("git-switcher")
  .description(
    "Manage multiple GitHub accounts (separate SSH key + git identity per project folder)",
  );

program
  .command("setup")
  .description("Create/update one or more profiles")
  .option("-n, --dry-run", "print what would change without writing anything")
  .action((opts) => run(() => setup(parseOptions(opts))));

program
  .command("show")
  .description("Show existing profiles and their status")
  .action(() => run(show));

program
  .command("repair <path>")
  .description("Fix a repo's 'origin' remote to match its profile")
  .option("-n, --dry-run", "print what would change without writing anything")
  .action((repoPath: string, opts) =>
    run(() => repair(parseArg(PathArgSchema, repoPath), parseOptions(opts))),
  );

program
  .command("uninstall <profileId>")
  .description("Remove a profile from ssh config / gitconfig")
  .option("-n, --dry-run", "print what would change without writing anything")
  .action((profileId: string, opts) =>
    run(() =>
      uninstall(parseArg(ProfileIdArgSchema, profileId), parseOptions(opts)),
    ),
  );

await program.parseAsync();
