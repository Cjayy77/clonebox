const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { VERDICT } = require('./atime-probe');
const { execSafe } = require('../scanners/utils');

// Verdicts, ordered from "leave it alone" to "this is dead weight".
const V = {
  ACTIVE: 'active',       // referenced by a project you've touched recently
  STALE: 'stale',         // referenced only by projects gone quiet
  ORPHAN: 'orphan',       // nothing on disk references it, and it looks untouched
  UNKNOWN: 'unknown',     // not enough signal to say — never recommend removing these
  PROTECTED: 'protected', // removing it would break the machine or the toolchain
};

const DAY = 86400000;

// Things that are load-bearing regardless of whether a project names them.
// Being wrong here means recommending someone delete their compiler, so the
// list errs heavily toward caution.
const PROTECTED_PATTERNS = [
  /^(bash|sh|zsh|coreutils|systemd|kernel|linux-|libc|glibc|openssl|ca-certificates)/i,
  /^(apt|dpkg|snapd|brew|winget|choco|rpm|yum|dnf)$/i,
  /^(git|curl|wget|ssh|openssh|sudo|nano|vim)$/i,
  /^(node|npm|python3?|pip3?|ruby|perl|go|rustc|cargo)$/i,
  /^(gcc|g\+\+|make|cmake|clang|build-essential)/i,
];

// Regexes are guesswork. The package manager already knows which packages the
// system depends on, so ask it rather than pattern-matching names. Debian
// marks these Essential or Priority required/important/standard; flagging any
// of them as removable would be actively dangerous advice.
async function buildSystemCriticalSet() {
  const critical = new Set();
  if (process.platform === 'linux') {
    const out = await execSafe(
      "dpkg-query -W -f='${Package}\\t${Priority}\\t${Essential}\\n'"
    );
    if (out) {
      for (const line of out.split('\n')) {
        const [name, priority, essential] = line.split('\t');
        if (!name) continue;
        if (essential === 'yes' || ['required', 'important', 'standard'].includes(priority)) {
          critical.add(name.toLowerCase());
        }
      }
    }
  }
  return critical;
}

function isProtected(item, criticalSet) {
  if (criticalSet && criticalSet.has(String(item.name).toLowerCase())) return true;
  return PROTECTED_PATTERNS.some((re) => re.test(item.name));
}

// Build the set of every name referenced by any project, plus the toolchains
// those projects imply (a pubspec.yaml implies flutter even though no line in
// it says "flutter").
function buildReferenceIndex(projects, staleAfterDays) {
  const now = Date.now();
  const index = new Map(); // lowercased name -> { projects: [], newestActivity: Date }

  const add = (name, project) => {
    const key = String(name).toLowerCase();
    if (!index.has(key)) index.set(key, { projects: [], newestActivity: null });
    const entry = index.get(key);
    entry.projects.push(project);
    if (project.lastActivity && (!entry.newestActivity || project.lastActivity > entry.newestActivity)) {
      entry.newestActivity = project.lastActivity;
    }
  };

  for (const project of projects) {
    project.declared.forEach((d) => add(d, project));
    project.toolchain.forEach((t) => add(t, project));
    project.ecosystems.forEach((e) => add(e, project));
  }

  return {
    index,
    lookup(name) {
      const key = String(name).toLowerCase();
      let hit = index.get(key);
      // Try a couple of common name shapes before giving up: scoped npm
      // packages, and apt's habit of suffixing (-dev, -bin, 3, etc).
      if (!hit && key.startsWith('@')) hit = index.get(key.split('/').pop());
      if (!hit) hit = index.get(key.replace(/(-dev|-bin|-cli|-common|\d+(\.\d+)*)$/, ''));
      return hit || null;
    },
    isStale(activity) {
      if (!activity) return true;
      return now - activity.getTime() > staleAfterDays * DAY;
    },
  };
}

// Most scanned packages carry no path, which strands them in "unknown".
// Resolving them to a real binary is what turns a guess into evidence, so
// index every executable on PATH once rather than shelling out per package.
async function buildBinaryIndex() {
  const index = new Map(); // binary name -> full path
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!index.has(name)) index.set(name, path.join(dir, name));
    }
  }
  return index;
}

// A package's binary is often named differently from the package itself.
// These are the shapes that actually recur; anything more speculative would
// risk statting an unrelated binary and reporting confident nonsense.
function candidateBinaryNames(item) {
  const n = item.name;
  const out = [n, n.toLowerCase()];
  out.push(n.replace(/^(python3?-|node-|lib|ruby-|golang-)/, ''));
  out.push(n.replace(/(-dev|-bin|-cli|-common|-utils|-server)$/, ''));
  if (n.startsWith('@')) out.push(n.split('/').pop());
  return [...new Set(out)].filter(Boolean);
}

async function getAccessAge(targetPath) {
  if (!targetPath) return null;
  try {
    const st = await fsp.stat(targetPath);
    return {
      atime: st.atime,
      ageDays: Math.floor((Date.now() - st.atime.getTime()) / DAY),
      sizeBytes: st.isDirectory() ? null : st.size,
    };
  } catch {
    return null;
  }
}

async function analyze(items, projects, atimeVerdict, options = {}) {
  const staleAfterDays = options.staleAfterDays || 180;
  const unusedAfterDays = options.unusedAfterDays || 365;
  const refs = buildReferenceIndex(projects, staleAfterDays);

  // If the filesystem doesn't record reads, age is not evidence. Say so and
  // fall back to reference data alone rather than inventing confidence.
  const ageUsable = atimeVerdict === VERDICT.RELIABLE || atimeVerdict === VERDICT.COARSE;

  const binIndex = ageUsable ? await buildBinaryIndex() : new Map();
  const criticalSet = await buildSystemCriticalSet();
  const results = [];

  for (const item of items) {
    let targetPath = item.path || item.originalPath || null;
    let resolvedVia = targetPath ? 'declared path' : null;

    if (!targetPath && binIndex.size) {
      for (const candidate of candidateBinaryNames(item)) {
        if (binIndex.has(candidate)) {
          targetPath = binIndex.get(candidate);
          resolvedVia = `binary ${candidate}`;
          break;
        }
      }
    }

    const access = ageUsable ? await getAccessAge(targetPath) : null;
    const ref = refs.lookup(item.name);

    let verdict;
    let reasons = [];
    let confidence = 'low';

    if (isProtected(item, criticalSet)) {
      verdict = V.PROTECTED;
      reasons.push(
        criticalSet.has(String(item.name).toLowerCase())
          ? 'marked essential or required by the system package manager — never suggested for removal'
          : 'core toolchain component — excluded from removal suggestions'
      );
      confidence = 'high';
    } else if (ref) {
      const stale = refs.isStale(ref.newestActivity);
      const names = ref.projects.slice(0, 3).map((p) => p.name);
      if (stale) {
        verdict = V.STALE;
        reasons.push(
          `referenced by ${ref.projects.length} project(s) — ${names.join(', ')}` +
            (ref.newestActivity
              ? `, newest activity ${daysAgo(ref.newestActivity)}`
              : ', no dateable activity')
        );
        confidence = 'high';
      } else {
        verdict = V.ACTIVE;
        reasons.push(`used by ${names.join(', ')} (active ${daysAgo(ref.newestActivity)})`);
        confidence = 'high';
      }
    } else if (access && access.ageDays > unusedAfterDays) {
      verdict = V.ORPHAN;
      reasons.push(
        `no project references it; last read ${access.ageDays} days ago (via ${resolvedVia})`
      );
      confidence = atimeVerdict === VERDICT.COARSE ? 'medium' : 'high';
    } else if (access) {
      verdict = V.UNKNOWN;
      reasons.push(
        `no project references it, but it was read ${access.ageDays} days ago (via ${resolvedVia})`
      );
      confidence = 'medium';
    } else {
      verdict = V.UNKNOWN;
      reasons.push(
        ageUsable
          ? 'no project reference and no readable path to check access time'
          : 'no project reference; access times unavailable on this filesystem'
      );
      confidence = 'low';
    }

    results.push({
      ...item,
      verdict,
      reasons,
      confidence,
      accessAgeDays: access ? access.ageDays : null,
      resolvedPath: targetPath,
      referencedBy: ref ? ref.projects.map((p) => p.path) : [],
    });
  }

  return results;
}

function daysAgo(date) {
  if (!date) return 'unknown';
  const d = Math.floor((Date.now() - date.getTime()) / DAY);
  if (d < 1) return 'today';
  if (d < 60) return `${d} days ago`;
  if (d < 730) return `${Math.round(d / 30)} months ago`;
  return `${(d / 365).toFixed(1)} years ago`;
}

function summarize(results) {
  const counts = {};
  for (const v of Object.values(V)) counts[v] = results.filter((r) => r.verdict === v).length;
  const reclaimable = results
    .filter((r) => (r.verdict === V.ORPHAN || r.verdict === V.STALE) && r.bytes)
    .reduce((sum, r) => sum + r.bytes, 0);
  return { counts, reclaimableBytes: reclaimable };
}

module.exports = { analyze, summarize, V, daysAgo };
