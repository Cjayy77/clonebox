const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execSafe } = require('../scanners/utils');

// This is the part existing tools don't do. `apt autoremove` knows about
// package-to-package dependencies. Nothing knows that the reason `flutter` is
// on your disk is a project you archived last year.
//
// So: walk the filesystem for project manifests, extract what each project
// declares it needs, and date each project by its last git commit. That gives
// a reference graph from "things I actually work on" to "things installed".

const MANIFESTS = {
  'package.json': { ecosystem: 'npm', toolchain: ['node', 'npm'] },
  'pubspec.yaml': { ecosystem: 'pub', toolchain: ['flutter', 'dart'] },
  'requirements.txt': { ecosystem: 'pip', toolchain: ['python3'] },
  'pyproject.toml': { ecosystem: 'pip', toolchain: ['python3'] },
  'Pipfile': { ecosystem: 'pip', toolchain: ['python3'] },
  'environment.yml': { ecosystem: 'conda', toolchain: ['conda'] },
  'Cargo.toml': { ecosystem: 'cargo', toolchain: ['rust', 'cargo'] },
  'go.mod': { ecosystem: 'go', toolchain: ['go'] },
  Gemfile: { ecosystem: 'gem', toolchain: ['ruby'] },
  'composer.json': { ecosystem: 'composer', toolchain: ['php'] },
  'pom.xml': { ecosystem: 'maven', toolchain: ['openjdk', 'maven'] },
  'build.gradle': { ecosystem: 'gradle', toolchain: ['openjdk', 'gradle'] },
  'build.gradle.kts': { ecosystem: 'gradle', toolchain: ['openjdk', 'gradle'] },
  'Dockerfile': { ecosystem: 'docker', toolchain: ['docker'] },
  'docker-compose.yml': { ecosystem: 'docker', toolchain: ['docker'] },
  'CMakeLists.txt': { ecosystem: 'cmake', toolchain: ['cmake'] },
};

// Directories that are never projects and are expensive to descend into.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'venv', '.venv', 'env', '__pycache__',
  'target', 'build', 'dist', '.gradle', '.dart_tool', 'Pods', 'vendor',
  '.cache', '.local', '.npm', '.pub-cache', '.cargo', '.rustup', '.nvm',
  'Library', 'AppData', 'Applications', 'System', 'Windows', 'Program Files',
  '.Trash', '.trash', 'snap', '.m2',
]);

async function findProjects(roots, { maxDepth = 5, progressCb = () => {} } = {}) {
  const projects = [];
  const seen = new Set();

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    progressCb(`Searching ${root}…`);
    await walk(root, 0);
  }

  async function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    const found = Object.keys(MANIFESTS).filter((m) => names.has(m));

    if (found.length && !seen.has(dir)) {
      seen.add(dir);
      projects.push(await describeProject(dir, found));
      // Don't descend into a project's subfolders — monorepo packages would
      // otherwise each register as separate projects and skew the counts.
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.config') continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  return projects;
}

async function describeProject(dir, manifestFiles) {
  const ecosystems = new Set();
  const toolchain = new Set();
  const declared = new Set();

  for (const file of manifestFiles) {
    const meta = MANIFESTS[file];
    ecosystems.add(meta.ecosystem);
    meta.toolchain.forEach((t) => toolchain.add(t));

    const deps = await extractDeclared(path.join(dir, file), file);
    deps.forEach((d) => declared.add(d.toLowerCase()));
  }

  const lastCommit = await gitLastCommit(dir);
  const lastModified = await newestFileTime(dir);

  return {
    path: dir,
    name: path.basename(dir),
    manifests: manifestFiles,
    ecosystems: [...ecosystems],
    toolchain: [...toolchain],
    declared: [...declared],
    lastCommit,
    lastModified,
    // Git commit date wins whenever it exists. File mtime is only a fallback
    // for non-git projects: a checkout, a backup restore, or a cloud-sync pass
    // rewrites mtime and would make a long-dead project look active. Taking
    // max() of the two silently destroyed the signal we care about.
    lastActivity: lastCommit || lastModified || null,
    activitySource: lastCommit ? 'git' : lastModified ? 'file-mtime' : 'none',
  };
}

// Parse dependency names out of a manifest. Deliberately shallow: we want the
// set of names a project references, not a resolved dependency tree.
async function extractDeclared(filePath, fileName) {
  let raw;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  try {
    if (fileName === 'package.json') {
      const pkg = JSON.parse(raw);
      return [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
      ];
    }

    if (fileName === 'pubspec.yaml') {
      // Top-level-ish YAML keys under dependencies blocks
      const names = [];
      let inDeps = false;
      for (const line of raw.split('\n')) {
        if (/^(dev_)?dependencies:/.test(line)) { inDeps = true; continue; }
        if (/^\S/.test(line)) inDeps = false;
        if (inDeps) {
          const m = line.match(/^\s{2}([A-Za-z0-9_]+):/);
          if (m) names.push(m[1]);
        }
      }
      return names;
    }

    if (fileName === 'requirements.txt') {
      return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
        .map((l) => l.split(/[=<>!~\[; ]/)[0])
        .filter(Boolean);
    }

    if (fileName === 'pyproject.toml' || fileName === 'Cargo.toml' || fileName === 'Pipfile') {
      const names = [];
      const depMatches = raw.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm);
      for (const m of depMatches) names.push(m[1]);
      return names;
    }

    if (fileName === 'go.mod') {
      return [...raw.matchAll(/^\s*([\w.\-/]+)\s+v[\d.]/gm)].map((m) => {
        const parts = m[1].split('/');
        return parts[parts.length - 1];
      });
    }

    if (fileName === 'Gemfile') {
      return [...raw.matchAll(/gem\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    }

    if (fileName === 'composer.json') {
      const pkg = JSON.parse(raw);
      return [...Object.keys(pkg.require || {}), ...Object.keys(pkg['require-dev'] || {})];
    }
  } catch {
    return [];
  }

  return [];
}

async function gitLastCommit(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const out = await execSafe(`git -C "${dir}" log -1 --format=%cI`);
  if (!out) return null;
  const d = new Date(out.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

// Newest source file in the project root, as a fallback for non-git projects.
// Shallow on purpose — recursing defeats the point on large trees.
async function newestFileTime(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    let newest = null;
    for (const e of entries.slice(0, 100)) {
      if (!e.isFile()) continue;
      try {
        const st = await fsp.stat(path.join(dir, e.name));
        if (!newest || st.mtime > newest) newest = st.mtime;
      } catch { /* skip */ }
    }
    return newest;
  } catch {
    return null;
  }
}

function defaultRoots() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Documents'), path.join(home, 'Projects'), path.join(home, 'projects'),
    path.join(home, 'dev'), path.join(home, 'Dev'), path.join(home, 'src'),
    path.join(home, 'code'), path.join(home, 'Code'), path.join(home, 'repos'),
    path.join(home, 'workspace'), path.join(home, 'Desktop'), home,
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

module.exports = { findProjects, defaultRoots, MANIFESTS };
