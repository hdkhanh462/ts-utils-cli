<div align="center">
	<h3 align="center">TS Utils CLI</h3>
	<p>A collection of small, focused command-line utilities built with TypeScript and Bun. Includes tools for finding/removing duplicate files and compressing large folders into size-bounded zip bundles.</p>
	<div>
		<img src="https://img.shields.io/badge/-Bun-000000?logo=bun&logoColor=white" alt="Bun">
		<img src="https://img.shields.io/badge/-Typescript-3178C6?logo=typescript&logoColor=white" alt="Typescript">
		<img src="https://img.shields.io/badge/-Zod-3E67B1?logo=zod&logoColor=white" alt="Zod">
		<img src="https://img.shields.io/badge/-Commander.js-000000?logo=javascript&logoColor=white" alt="Commander.js">
		<img src="https://img.shields.io/badge/-Biome-60A5FA?logo=biome&logoColor=white" alt="Biome">
	</div>
</div>

---

### 🚀 Features

- **duplicate-remover** — scan a folder, find duplicate files by content hash, and remove or dry-run report them, with a persistent cache to skip unchanged files on repeat runs
- **folder-zipper** — split a large folder into multiple zip bundles targeting a min/max size range, skipping (or moving aside) files that are too large on their own
- Colored console logger (`[INFO]` / `[WARNING]` / `[ERROR]`), no emoji
- CLI input validated with Zod, failing cleanly with a readable error message instead of a stack trace

### 🔨 Installation Guide

Follow these steps to install and use the application.

**Requirements**

Software:

- [Bun](https://bun.sh/) (version 1.3.9 or higher)

Hardware:

- RAM: 4GB or higher
- CPU: Any modern processor

**Preparation**

- Clone this repository and install dependencies:
	```bash
	git clone git@github.com:hdkhanh462/ts-utils-cli.git
	cd ts-utils-cli
	bun install
	```

### 🌐 Install as Global CLI

Each feature is exposed as a `bin` entry in [package.json](package.json), so it can be installed globally with Bun and run as a standalone command from anywhere, without `bun run` or the repo path.

- Install both CLIs globally from the repo root:
	```bash
	bun install -g .
	```
	This adds `duplicate-remover` and `folder-zipper` to Bun's global bin directory (printed by `bun pm bin -g`). Make sure that directory is on your `PATH` (the Bun installer adds it by default).
- Use them from any directory:
	```bash
	duplicate-remover <folder> [options]
	folder-zipper <folder> [options]
	```
- To pick up local changes after editing the source, reinstall:
	```bash
	bun install -g .
	```
- To remove a global CLI:
	```bash
	bun remove -g ts-utils-cli
	```

Alternatively, use `bun link` during development to symlink the package instead of copying it, so changes are picked up without reinstalling:

```bash
bun link
bun link ts-utils-cli -g
```

### 📦 Usage

**Duplicate Remover**

```bash
bun run duplicate-remover <folder> [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `-n, --dry-run` | Report duplicates without deleting | `false` |
| `-c, --concurrency <number>` | Number of parallel hashing jobs | number of CPU cores |
| `--cache-dir <path>` | Directory to store the file-hash cache | `~/.dedupe-cache` |
| `--no-confirm` | Skip the confirmation prompt before deleting | prompts by default |
| `-v, --verbose` | Show verbose output (e.g. cache hits) | `false` |

**Folder Zipper**

```bash
bun run folder-zipper <folder> [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `-p, --prefix <prefix>` | Zip file name prefix | *(none)* |
| `-s, --suffix <suffix>` | Zip file name suffix | `_<current date>` |
| `-o, --output <dir>` | Output directory for the zip file(s) | parent of the target folder |
| `-d, --delete` | Delete original files after compression instead of moving them to a temp folder | `false` |
| `-m, --max-parts <number>` | Maximum number of zip files to create | unlimited |
| `--oversized-dir <dir>` | Move files ≥ 200 MB into this directory instead of leaving them in place | leaves them in place |

### 📚 Docs

- [src/features/duplicate-remover](src/features/duplicate-remover) — duplicate-remover source
- [src/features/folder-zipper](src/features/folder-zipper) — folder-zipper source
- [src/utils](src/utils) — shared utilities (logger, file walking, concurrency, etc.)
