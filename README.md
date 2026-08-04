# Clonebox

Scan a machine for installed packages, SDKs, and tool folders; pick what
matters in a visual UI; package it for a new device — locally or via your
own cloud storage.

## Setup

```bash
npm install
npm start
```

Node 18+ required.

**Platform status:** developed and tested on Linux. Windows and macOS code
paths are written but unverified — on macOS specifically, expect to check
Homebrew's Apple Silicon prefix (`/opt/homebrew`), and note the app is
unsigned, so Gatekeeper needs a right-click → Open on first launch.

## Interface

A dense native-style utility window rather than a web page: system fonts,
sortable columns, category tree, status bar, and an activity log. It follows
your OS light/dark setting.

## Status

The scanner, packager, and both installer scripts have been executed and
verified end-to-end on Linux (853 items detected on a real system; package
built, cross-OS path exercised, real extraction + PATH modification
confirmed). The Electron UI itself has been syntax-checked but not launched
in a desktop session — expect first-run polish issues there, not in the
underlying logic.

## How it works

1. **Scan** — probes every tool present on the machine. Each probe is
   isolated, so a missing or broken tool logs a skip instead of failing the
   whole scan.
2. **Filter** — checklist grouped by category, with search and a target-OS
   selector that greys out anything which won't survive the move.
3. **Package** — writes `manifest.json`, zipped SDK folders, `install.ps1`,
   `install.sh`, and `COMPATIBILITY.md` to a folder you choose.
4. **Restore** — run `install.ps1` or `install.sh` on the new machine.

## What gets scanned

| Source | Cross-OS? |
|---|---|
| npm globals, pip, VS Code extensions, Ollama models | yes |
| cargo, gem, dotnet global tools | yes |
| winget, Chocolatey (Windows) | no |
| Homebrew formulae + casks (macOS) | no |
| apt, snap, flatpak (Linux) | no |
| Flutter SDK, pub cache, Android SDK, Gradle cache | same-OS copy only |
| nvm/fnm Node versions, mise, SDKMAN | same-OS copy only |
| Visual Studio / Windows SDK | listed only |
| Conda envs, Go binaries | listed only |
| WSL distros | flagged as needing a separate scan |
| ~52 common tools | mapped to per-OS equivalents (see below) |
| Unmanaged binaries in `/usr/local/bin`, `~/.local/bin`, `/opt` | listed only |

## Cross-OS transfer (e.g. Windows → macOS)

Three outcomes per item, not two:

1. **Installs directly.** npm, pip, VS Code, Ollama, cargo, gem, dotnet —
   these package managers exist everywhere and the commands are identical.
2. **Installs via a verified equivalent.** A curated table maps ~52 common
   tools across winget / Chocolatey / Homebrew / apt / snap. A Windows
   `Git.Git` becomes `brew install git` on macOS or `apt install -y git` on
   Linux, and the installer reports `[OK-EQUIV] Git.Git -> installed the
   macOS equivalent: brew install git` so you always know a substitution
   happened rather than an exact restore.
3. **No known equivalent — skipped, not guessed.** Either the tool isn't in
   the table, or it's genuinely platform-exclusive (PowerToys, Xcode). These
   are reported with the reason.

Every mapping in `src/packager/equivalents.js` is verified by hand. Nothing
is inferred from name similarity, deliberately: apt's `python` is not
Python 3, and a fuzzy match for "python" would happily install
`python-is-python2`. Installing the wrong software is worse than installing
nothing, so unmapped items are always skipped.

The table also handles name mismatches that a naive tool would miss — apt's
`nodejs` and winget's `OpenJS.NodeJS.LTS` both resolve to the same canonical
entry, so a Linux → Windows move gets the right package.

### Substitution is always your choice

Nothing is substituted silently. A policy is set when you package and
recorded in the manifest:

- **Ask each time** (default) — the installer stops at each substitution and
  shows you the exact command before running it:

  ```
  Git.Git is not available on Linux.
  Verified equivalent: apt install -y git
  Install this equivalent? [y]es / [n]o / [a]ll / [s]kip all:
  ```

  `a` accepts all remaining, `s` skips all remaining. Declined items are
  logged as `[DECLINED]` so you can see what you passed on.
- **Install automatically** — substitute without prompting, still logged as
  `[OK-EQUIV]`.
- **Never substitute** — skip anything needing one.

Override at run time with `--yes-equivalents` / `--no-equivalents`
(`-YesEquivalents` / `-NoEquivalents` on Windows). If the script is run
without a terminal (piped, CI), "ask" downgrades to "never" rather than
assuming consent.

Equivalents also act as a **failure fallback**: if the original install
command exists but fails, the installer offers the equivalent before giving
up.

To add your own mapping, append an entry to `equivalents.js` with per-OS
commands and the `aliases` used by each package manager.

## Install script behaviour

Both scripts support `--dry-run` / `-DryRun` to print everything they would
do without changing anything. Run that first.

- **PATH is set permanently** — user-level environment variable on Windows,
  appended to `.zshrc`/`.bashrc`/`.profile` on Unix. If an SDK has a `bin/`
  or `platform-tools/` subfolder, that's what gets added, not the root.
- **Elevation is never auto-attempted.** A script can't reliably answer a
  UAC or sudo prompt, so items needing admin are collected into
  `elevated-commands.ps1`/`.sh` for you to review and run yourself.
- **Everything is skipped gracefully** when the required tool is absent, and
  results are written to `install-log.txt`.
- `install.sh` needs `jq` (`brew install jq` / `sudo apt install jq`).

## Deliberate omissions

- **OS settings and preferences** (dock, keyboard, trackpad). Not reliably
  scriptable across OS versions; worth a manual pass.
- **SSH keys and GitHub auth.** Generate fresh keys on the new machine and
  re-run `gh auth login`. Moving secrets through a zip is worse practice
  than spending two minutes re-authenticating.
- **Malware scanning.** Different problem entirely — use Defender or ClamAV.
- **Cloud API upload.** The "prepare for cloud" option builds the folder;
  you drag it into Drive/OneDrive/Dropbox yourself. No OAuth, no stored
  tokens.

## Known limits

- Anything installed by a one-off script (`curl | sh`, a manually
  downloaded binary) is not registered with any package manager and
  therefore cannot be reliably enumerated. The "Unmanaged binaries"
  category is a best-effort hint on macOS/Linux only.
- pip scanning captures top-level packages from the active Python
  environment. If a virtualenv is active it's flagged in the category name;
  conda envs are listed with instructions to use `conda env export` instead.
- Go records no install paths for its binaries, so those are listed by name
  only.
- Emulator system images and `.git` histories are excluded from SDK zips
  deliberately — they're large and re-downloadable.
