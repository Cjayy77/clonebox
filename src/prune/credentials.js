const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execSafe } = require('../scanners/utils');

/**
 * Credential surface scan.
 *
 * HARD RULE, enforced by construction: this module never reads, stores, logs,
 * or emits a credential value. It reports only metadata — path, type, age,
 * algorithm, and whether anything still references it.
 *
 * Where a file must be parsed structurally (an SSH public key header, a git
 * remote hostname, a YAML key name), only the non-secret token is extracted
 * and the rest is discarded. Private key files are NEVER opened; everything
 * known about them comes from stat() and from their matching .pub file.
 *
 * We also never call any remote API to test whether a token is live. Sending
 * your credential somewhere on the tool's own initiative is not a check —
 * it's an exfiltration with good intentions.
 */

const DAY = 86400000;
const home = os.homedir();

// Public-key headers are safe to read: they are, by definition, public.
const DEPRECATED_ALGOS = {
  'ssh-dss': 'DSA is disabled by default in OpenSSH 7.0+ and considered broken.',
  'ssh-rsa': 'SHA-1 RSA signatures were disabled by default in OpenSSH 8.8+. Key may still be fine if it is 3072-bit or larger and used with rsa-sha2 — verify before relying on it.',
};

function ageDays(date) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / DAY);
}

function describeAge(days) {
  if (days === null) return 'unknown age';
  if (days < 60) return `${days} days old`;
  if (days < 730) return `${Math.round(days / 30)} months old`;
  return `${(days / 365).toFixed(1)} years old`;
}

// ---------------------------------------------------------------------------
// SSH keys
// ---------------------------------------------------------------------------

async function scanSshKeys() {
  const sshDir = path.join(home, '.ssh');
  const findings = [];

  let entries;
  try {
    entries = await fsp.readdir(sshDir);
  } catch {
    return findings;
  }

  for (const name of entries) {
    if (!name.endsWith('.pub')) continue;

    const pubPath = path.join(sshDir, name);
    const privPath = pubPath.slice(0, -4);
    const hasPrivate = fs.existsSync(privPath);

    // Only the .pub file is opened. The private key is described entirely
    // from filesystem metadata.
    let algo = 'unknown';
    let comment = '';
    let bits = null;
    try {
      const pub = await fsp.readFile(pubPath, 'utf8');
      const parts = pub.trim().split(/\s+/);
      algo = parts[0] || 'unknown';
      // The comment field is usually an email or hostname — useful context,
      // and not secret. The key body (parts[1]) is deliberately discarded.
      comment = parts.slice(2).join(' ');
    } catch {
      /* unreadable; metadata below still applies */
    }

    // ssh-keygen reports bit length without us parsing key material.
    const kg = await execSafe(`ssh-keygen -l -f "${pubPath}"`);
    if (kg) {
      const m = kg.match(/^(\d+)\s/);
      if (m) bits = Number(m[1]);
    }

    let stat = null;
    try {
      stat = await fsp.stat(hasPrivate ? privPath : pubPath);
    } catch {
      /* ignore */
    }

    const created = stat ? stat.mtime : null;
    const days = ageDays(created);
    const concerns = [];

    if (DEPRECATED_ALGOS[algo]) concerns.push(DEPRECATED_ALGOS[algo]);
    if (bits && algo === 'ssh-rsa' && bits < 3072) {
      concerns.push(`RSA key is only ${bits}-bit; 3072 is the modern minimum.`);
    }
    if (days !== null && days > 730) {
      concerns.push(`Key has not been rotated in over ${describeAge(days).replace(/ old$/, "")}.`);
    }

    // Permissions matter: a private key readable by others is a real problem.
    if (hasPrivate && stat && process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      if (mode & 0o077) {
        concerns.push(
          `Private key permissions are ${mode.toString(8)}; SSH expects 600. Fix with: chmod 600 "${privPath}"`
        );
      }
    }

    findings.push({
      kind: 'ssh-key',
      label: name.replace(/\.pub$/, ''),
      path: privPath,
      algorithm: algo,
      bits,
      comment,
      hasPrivateKey: hasPrivate,
      ageDays: days,
      concerns,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Git remotes with embedded credentials
// ---------------------------------------------------------------------------

// A URL like https://user:ghp_xxx@github.com/org/repo leaks a live token into
// every clone of that config. We detect the *shape* and report the host — the
// credential portion is never captured.
async function scanGitRemotes(projects) {
  const findings = [];

  for (const project of projects) {
    const configPath = path.join(project.path, '.git', 'config');
    if (!fs.existsSync(configPath)) continue;

    let raw;
    try {
      raw = await fsp.readFile(configPath, 'utf8');
    } catch {
      continue;
    }

    for (const line of raw.split('\n')) {
      const m = line.match(/url\s*=\s*(https?:\/\/)([^@\s/]+)@([^\s/]+)/);
      if (!m) continue;

      // m[2] is the credential portion. It is matched to detect the pattern
      // and then deliberately dropped — only its shape is described.
      const credentialShape = m[2].includes(':') ? 'username:token' : 'username-or-token';
      const host = m[3];

      findings.push({
        kind: 'git-embedded-credential',
        label: `${project.name} → ${host}`,
        path: configPath,
        host,
        credentialShape,
        ageDays: ageDays(project.lastActivity),
        concerns: [
          `Remote URL embeds a ${credentialShape} in plaintext. Anyone with read access to this repo folder has it.`,
          'Switch to SSH, or use a credential helper: git config --global credential.helper store (or the OS keychain helper).',
        ],
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Credential files from common tools
// ---------------------------------------------------------------------------

// Each entry describes where a tool keeps credentials and how to revoke them.
// `structuralKeys` names the non-secret fields safe to extract; anything else
// in the file is never touched.
const CREDENTIAL_FILES = [
  {
    kind: 'github-cli',
    rel: path.join('.config', 'gh', 'hosts.yml'),
    label: 'GitHub CLI authentication',
    // Only the indented `user:` value names an account. The top-level key is
    // the hostname, which would otherwise be listed as if it were a login.
    structuralKeys: /^\s+user:\s*(\S+)/,
    revoke: 'gh auth logout, or manage tokens at github.com/settings/tokens',
  },
  {
    kind: 'aws',
    rel: path.join('.aws', 'credentials'),
    label: 'AWS credentials',
    structuralKeys: /^\[(\S+)\]/,
    revoke: 'Rotate in IAM console; delete unused access keys entirely.',
  },
  {
    kind: 'kube',
    rel: path.join('.kube', 'config'),
    label: 'Kubernetes cluster credentials',
    structuralKeys: /^\s*-?\s*name:\s*(\S+)/,
    revoke: 'Remove stale contexts: kubectl config delete-context <name>',
  },
  {
    kind: 'docker',
    rel: path.join('.docker', 'config.json'),
    label: 'Docker registry authentication',
    structuralKeys: null,
    revoke: 'docker logout <registry>',
  },
  {
    kind: 'npm',
    rel: '.npmrc',
    label: 'npm registry token',
    structuralKeys: null,
    revoke: 'npm token revoke <id>, list with npm token list',
  },
  {
    kind: 'pypi',
    rel: '.pypirc',
    label: 'PyPI upload token',
    structuralKeys: null,
    revoke: 'Revoke at pypi.org/manage/account/token/',
  },
  {
    kind: 'netrc',
    rel: '.netrc',
    label: 'netrc stored logins',
    structuralKeys: /^\s*machine\s+(\S+)/,
    revoke: 'Edit ~/.netrc and remove unused machine entries.',
  },
  {
    kind: 'gcloud',
    rel: path.join('.config', 'gcloud', 'credentials.db'),
    label: 'Google Cloud credentials',
    structuralKeys: null,
    revoke: 'gcloud auth revoke <account>',
  },
];

async function scanCredentialFiles() {
  const findings = [];

  for (const spec of CREDENTIAL_FILES) {
    const full = path.join(home, spec.rel);
    let stat;
    try {
      stat = await fsp.stat(full);
    } catch {
      continue;
    }

    const days = ageDays(stat.mtime);
    const concerns = [];
    const accounts = [];

    // Only structural, non-secret identifiers are extracted — account names,
    // hostnames, profile labels. Values are never captured.
    if (spec.structuralKeys) {
      try {
        const raw = await fsp.readFile(full, 'utf8');
        for (const line of raw.split('\n')) {
          // Skip any line that looks like it carries a secret, before matching.
          if (/(token|password|secret|key)\s*[:=]/i.test(line)) continue;
          const m = line.match(spec.structuralKeys);
          if (m) {
            const name = m[1] || m[2];
            if (name && !accounts.includes(name)) accounts.push(name);
          }
        }
      } catch {
        /* unreadable — metadata still reported */
      }
    }

    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      if (mode & 0o077) {
        concerns.push(`File is readable beyond your user (mode ${mode.toString(8)}). Fix: chmod 600 "${full}"`);
      }
    }

    if (days !== null && days > 365) {
      concerns.push(`Not modified in ${describeAge(days).replace(/ old$/, '')} — likely holds credentials for work you've moved on from.`);
    }

    findings.push({
      kind: spec.kind,
      label: spec.label,
      path: full,
      accounts: accounts.slice(0, 10),
      ageDays: days,
      concerns,
      revoke: spec.revoke,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// .env files in projects
// ---------------------------------------------------------------------------

// Presence and staleness only. These files are never opened — a .env is
// nothing but secrets, so there is no safe structural parse.
async function scanEnvFiles(projects) {
  const findings = [];
  const ENV_NAMES = ['.env', '.env.local', '.env.production', '.env.development'];

  for (const project of projects) {
    for (const name of ENV_NAMES) {
      const full = path.join(project.path, name);
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }

      const projectAge = ageDays(project.lastActivity);
      const concerns = [];

      // The interesting case: a secrets file in a project nobody works on.
      if (projectAge !== null && projectAge > 365) {
        concerns.push(
          `Project has been inactive for ${describeAge(projectAge).replace(/ old$/, "")}, but still holds a secrets file. Any keys inside are probably still live and unmonitored.`
        );
      }

      // A .env that isn't ignored gets committed eventually.
      const gitignorePath = path.join(project.path, '.gitignore');
      if (fs.existsSync(path.join(project.path, '.git'))) {
        let ignored = false;
        try {
          const gi = await fsp.readFile(gitignorePath, 'utf8');
          ignored = gi.split('\n').some((l) => l.trim() === name || l.trim() === '.env' || l.trim() === '*.env');
        } catch {
          ignored = false;
        }
        if (!ignored) {
          concerns.push(`${name} is not listed in .gitignore — check whether it has been committed: git log --all -- ${name}`);
        }
      }

      findings.push({
        kind: 'env-file',
        label: `${name} in ${project.name}`,
        path: full,
        ageDays: ageDays(stat.mtime),
        projectInactiveDays: projectAge,
        concerns,
        note: 'Contents were not read.',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Orphan detection: keys whose hosts appear in no project
// ---------------------------------------------------------------------------

// An SSH key is "unreferenced" if no project remote points at a host it could
// plausibly serve. This is weak evidence on its own — a key may be used for
// servers, not repos — so it is reported as a question, never a recommendation.
async function correlateKeys(sshKeys, projects) {
  const hosts = new Set();

  for (const project of projects) {
    const configPath = path.join(project.path, '.git', 'config');
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = await fsp.readFile(configPath, 'utf8');
      for (const line of raw.split('\n')) {
        const ssh = line.match(/url\s*=\s*git@([^:]+):/);
        if (ssh) hosts.add(ssh[1].toLowerCase());
        const https = line.match(/url\s*=\s*https?:\/\/(?:[^@\s/]+@)?([^\s/]+)/);
        if (https) hosts.add(https[1].toLowerCase());
      }
    } catch {
      /* skip */
    }
  }

  // Also consult ~/.ssh/config for explicit host-to-key bindings.
  const boundKeys = new Set();
  try {
    const cfg = await fsp.readFile(path.join(home, '.ssh', 'config'), 'utf8');
    for (const line of cfg.split('\n')) {
      const m = line.match(/IdentityFile\s+(\S+)/i);
      if (m) boundKeys.add(path.basename(m[1].replace(/^~/, home)));
    }
  } catch {
    /* no ssh config */
  }

  return sshKeys.map((key) => {
    const basename = path.basename(key.path);
    const explicitlyBound = boundKeys.has(basename);
    // A key comment often names the host or account it was made for.
    const commentMentionsKnownHost = [...hosts].some(
      (h) => key.comment && key.comment.toLowerCase().includes(h.split('.')[0])
    );

    return {
      ...key,
      referenced: explicitlyBound || commentMentionsKnownHost,
      referenceNote: explicitlyBound
        ? 'Bound to a host in ~/.ssh/config'
        : commentMentionsKnownHost
        ? 'Key comment matches a host used by your projects'
        : 'No project remote or ssh_config entry obviously uses this key — it may serve a server rather than a repo, so verify before removing.',
    };
  });
}

async function scanCredentials(projects = []) {
  const sshRaw = await scanSshKeys();
  const sshKeys = await correlateKeys(sshRaw, projects);
  const [remotes, files, envs] = await Promise.all([
    scanGitRemotes(projects),
    scanCredentialFiles(),
    scanEnvFiles(projects),
  ]);

  return { sshKeys, remotes, files, envs };
}

module.exports = { scanCredentials, describeAge };
