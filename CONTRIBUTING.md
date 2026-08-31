# Contributing to Clonebox

Thanks for looking into contributing. Clonebox is a small, careful tool —
"careful" being the operative word, since it modifies PATH, installs
software, and moves SDKs between machines. The bar for correctness is
higher than usual for a dev utility, so please read this before opening a
PR.

## Ground rules

- **Nothing gets guessed.** If you're not sure a mapping, path, or command
  is correct on the target OS, don't add it — open an issue instead and
  flag it as unverified. Installing the wrong thing is worse than skipping
  it. This is the single most important rule in the project.
- **No silent substitution.** Any change that installs, moves, or
  overwrites something without the user being told first will be rejected.
- **No telemetry, no network calls beyond what's documented.** Clonebox
  doesn't phone home and doesn't upload anything itself (see "Cloud API
  upload" in the README). PRs that add analytics, crash reporting, or
  auto-update pings won't be merged.
- **Secrets stay out.** Don't add scanning/packaging support for SSH keys,
  API tokens, `.env` files, cloud credentials, or anything else that would
  turn Clonebox into a way to zip up secrets and move them around.

## Setup

```
npm install
npm start
```

Node 18+ is required. The scanner/packager/installer logic is verified on
Linux; the Electron GUI hasn't been run end-to-end in a desktop session
yet, so if you're testing there, expect rough edges and please report them.

## Where things live

- `src/packager/equivalents.js` — the hand-curated cross-OS tool mapping
  table (e.g. `Git.Git` → `brew install git` / `apt install -y git`).
- `bin/` — the `install.ps1` / `install.sh` restore scripts.
- `PRUNE.md` — notes on what's deliberately excluded from scans/packages.

If you're not sure where a change belongs, open an issue first rather than
guessing at the structure.

## Adding or fixing an equivalents.js mapping

This is the most common and most welcome kind of contribution. Each entry
needs:

1. **A canonical name** that aliases from different package managers
   resolve to (e.g. apt's `nodejs` and winget's `OpenJS.NodeJS.LTS` both
   need to map to the same entry).
2. **Per-OS install commands** — only for package managers you have
   personally run the command on. Don't copy a command from a blog post or
   documentation page without testing it.
3. **A note in the PR description** stating which OS(es) you tested on and
   how (fresh VM, container, existing machine, etc.).

Do not add a mapping based on name similarity alone. The README's example
is the right way to think about it: apt's `python` is not Python 3, and a
naive match would happily install `python-is-python2`. If a tool has no
verified equivalent, it's correct for Clonebox to skip it and say so —
that's a feature, not a gap to be papered over.

## Testing changes to the install scripts

Both `install.ps1` and `install.sh` support `--dry-run` / `-DryRun`. Always
test with dry-run first, then a real run in a disposable VM or container —
never on a machine you care about, since these scripts write to PATH and
can install software.

Things to check before submitting:

- Dry-run output matches what actually happens on a real run.
- Elevation-requiring items are collected into
  `elevated-commands.ps1`/`.sh` rather than triggering a UAC/sudo prompt
  directly.
- Failures for missing tools are skipped gracefully and logged to
  `install-log.txt`, not thrown as unhandled errors.
- `--yes-equivalents` / `--no-equivalents` (and the PowerShell equivalents)
  still behave correctly, including the non-interactive downgrade to
  "never substitute" when there's no terminal attached.

## Adding a new scan source

If you're adding support for scanning a new package manager or tool
category:

- Isolate the probe so a missing or broken tool logs a skip instead of
  failing the whole scan (this is a hard requirement, not a style
  preference — see how existing probes are structured).
- Say clearly in the PR whether the new source is cross-OS, same-OS-only,
  or listed-only, and update the "What gets scanned" table in the README
  to match.
- If it's Linux/macOS-only tooling, test on both if you can; if you can
  only test one, say so and someone can help verify the other before
  merge.

## Pull requests

- Keep PRs scoped to one change (one new mapping, one bug fix, one scan
  source) — easier to review and easier to verify claims about testing.
- Describe what you tested and on what OS. "Should work" without testing
  notes will likely get a request for more info before merge.
- If your change touches PATH modification, elevation, or anything that
  installs software, call that out explicitly at the top of the PR
  description.

## Reporting issues

Bug reports and "this equivalent is wrong/outdated" reports are just as
valuable as code. Please include:

- OS and version.
- What Clonebox did vs. what you expected.
- Relevant lines from `install-log.txt` if applicable.

## Out of scope

Per the README's "Deliberate omissions," the following won't be accepted
as contributions regardless of implementation quality:

- OS settings/preferences syncing (dock, keyboard, trackpad, etc.)
- SSH key or GitHub auth migration
- Malware scanning
- Built-in cloud upload with stored OAuth tokens

If you think one of these should be reconsidered, open an issue to discuss
the reasoning first rather than submitting a PR.
