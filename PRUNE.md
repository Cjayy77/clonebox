# clonebox-prune

> What's installed that nothing in your life references anymore?

Not a disk-usage tool. WizTree tells you what's *large*; `apt autoremove`
tells you what's an *orphaned dependency*. Neither can tell you that the
reason Flutter is on your disk is a project you archived last year.

That link — installed software ↔ the projects that justify it — is what
this builds.

```bash
npm run prune                      # scan common dev folders
node bin/clonebox-prune.js --roots ~/code,~/work --show all --json
```

Nothing is ever deleted. It only reports.

## How it decides

Three signals, joined:

1. **Project references.** Walks your disk for `package.json`,
   `pubspec.yaml`, `Cargo.toml`, `go.mod`, `requirements.txt`, `Gemfile`,
   `pom.xml`, `Dockerfile` and friends. Extracts declared dependencies, plus
   the toolchain each manifest *implies* — a `pubspec.yaml` means you need
   Flutter even though no line in it says so.
2. **Project liveness.** Dates each project by its last git commit. File
   mtime is a fallback only for non-git projects, because a checkout, backup
   restore, or cloud-sync pass rewrites mtime and would make a long-dead
   project look active.
3. **Access time.** Whether the binary has actually been read, resolved
   through a one-pass index of every executable on `PATH`.

## Verdicts

| Verdict | Meaning |
|---|---|
| `active` | Referenced by a project with recent commits |
| `stale` | Referenced *only* by projects that have gone quiet |
| `orphan` | Nothing references it and nothing has read it in a year |
| `unknown` | Not enough signal — **never** recommended for removal |
| `protected` | System-critical; excluded by design |

`protected` is decided by asking the package manager (`dpkg-query` Essential
and Priority fields), not by matching names. An early version used regexes
and confidently proposed removing `gzip`, `hostname`, and `dbus-daemon`.
Authoritative data replaced guesswork.

## The measurement problem

The whole premise depends on the filesystem recording reads, which is often
switched off. So it probes empirically at startup — writes a file, backdates
its atime, reads it, checks whether the kernel moved the timestamp:

- **`reliable`** — reads are recorded accurately.
- **`coarse`** — `relatime`, ~24h granularity. Fine for "unused for months",
  useless for "used today".
- **`disabled`** — `noatime`, or Windows NTFS (last-access updates are off by
  default since Vista). Age signals are unavailable; results fall back to
  project references alone, and the tool says so rather than pretending.

On Windows you can turn it on with
`fsutil behavior set disablelastaccess 0` (admin, reboot, small write cost).
Whether that's worth it is your call.

## What it can get wrong

- **Shell-only tools look unreferenced.** `jq`, `htop`, `ffmpeg` are used
  constantly and named in no manifest. They'll surface as orphans.
- **`unknown` means unknown**, not "safe to remove". It's the largest bucket
  by design.
- **Access time is not usage.** A file can be read by a backup or an indexer.
- **Fresh machines produce meaningless results.** If files were written once
  by an installer and never read, everything looks orphaned.

## Credential audit

```bash
node bin/clonebox-prune.js --only-credentials     # audit alone
node bin/clonebox-prune.js --credentials          # alongside the package scan
```

Same question as the rest of the tool, applied to the highest-stakes case:
*what's on this machine that you've forgotten about?* A GitHub token issued
14 months ago for an archived project is more dangerous than a stale npm
package, and nothing checks for it.

**The hard rule: credential values are never read, stored, logged, or
emitted.** Only metadata — path, type, age, algorithm, permissions, and
whether anything still references it.

How that's enforced:

- **Private key files are never opened.** Everything reported about them
  comes from `stat()` and from the matching `.pub` file, which is public by
  definition.
- **`.env` files are never opened.** A `.env` is nothing but secrets, so
  there's no safe structural parse — only presence and staleness.
- **Structural parsing discards values.** Extracting an account name from
  `hosts.yml` skips any line matching `token|password|secret|key`, and a
  git remote's credential portion is matched to detect the pattern, then
  dropped — only its *shape* (`username:token`) is described.
- **No network calls.** Whether a token is still live can only be answered
  by the issuing API, and sending your credential somewhere on the tool's
  own initiative is exfiltration with good intentions.

This is verified by a leak test: fixtures seed known fake secrets, and both
JSON and human-readable output are grepped for every one of them.

What it finds:

| Finding | Example |
|---|---|
| Deprecated key algorithms | `ssh-dss` key, disabled since OpenSSH 7.0 |
| Unrotated keys | RSA key untouched in 7 years |
| Wrong permissions | private key at mode 644 instead of 600 |
| Tokens in git remotes | `https://user:ghp_xxx@github.com/...` in `.git/config` |
| Stale credential files | `~/.aws/credentials` unmodified in 2.6 years |
| Secrets in dead projects | `.env` in a repo abandoned 3.5 years ago |
| Ungitignored `.env` | present and not listed in `.gitignore` |
| Unreferenced keys | no project remote or `ssh_config` entry uses it |

Each finding includes the revocation command — `gh auth logout`,
`npm token revoke`, IAM rotation — because the useful output is the next
action, not the observation.

**Clonebox still never transfers credentials.** Detecting them and moving
them are opposite decisions: generate a fresh key on the new machine and
re-authenticate. Two minutes of work versus a secret sitting in an archive
on a USB stick.

Limits worth knowing: an unreferenced key may serve a server rather than a
repo, so that signal is reported as a question, never a recommendation. And
if `ssh-keygen` isn't installed, bit lengths are unavailable and the tool
degrades to algorithm and age alone.

## Honest status

Built and tested on Linux with real data: an 854-item scan against fixture
projects correctly separated an active project's dependencies from those of
one abandoned 3.5 years ago. Windows and macOS paths are written but
unverified, and Windows will most likely report `disabled` for access times,
which materially weakens the results there.

The open question isn't whether it runs — it's whether its suggestions are
ones you'd actually act on. If everything it flags turns out to be something
you need, that's a real finding about the idea, and cheaply bought.
