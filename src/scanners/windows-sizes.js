const { execSafe, estimateFolderSize } = require('./utils');

// Package managers report identifiers, not disk usage. Windows does record
// install sizes, but in a different place: the Add/Remove Programs registry
// keys, which are keyed by display name rather than by winget/choco id. So
// sizes have to be joined across on names, and names don't line up exactly —
// "Microsoft.VisualStudioCode" vs "Microsoft Visual Studio Code".
//
// Every match therefore carries the registry name it matched and whether the
// join was exact or inferred, so the UI can mark inferred sizes and let the
// user see what was matched instead of trusting a bare number.

const PS_QUERY = [
  'powershell -NoProfile -ExecutionPolicy Bypass -Command',
  '"[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
  "$ErrorActionPreference='SilentlyContinue';",
  "$p=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
  '@(Get-ItemProperty $p | Where-Object { $_.DisplayName } |',
  "Select-Object @{n='key';e={$_.PSChildName}}, @{n='name';e={$_.DisplayName}},",
  "@{n='kb';e={$_.EstimatedSize}}, @{n='loc';e={$_.InstallLocation}})",
  '| ConvertTo-Json -Compress -Depth 3"',
].join(' ');

// Trailing version numbers, bitness markers and parenthetical notes are noise
// for matching: "Anaconda3 2025.06-0 (Python 3.13.5 64-bit)" is the same
// product as "Anaconda.Anaconda3".
const NOISE_WORDS = new Set(['version', 'x64', 'x86', 'bit', 'setup', 'installer']);

function stripVersionNoise(text) {
  return text
    .replace(/\([^)]*\)/g, ' ')            // "(Python 3.13.5 64-bit)"
    .replace(/\b\d+[-\w.]*\b/g, ' ')       // "2025.06-0", "1.16.1", "15"
    .replace(/\bv\d[\w.]*\b/gi, ' ')       // "v4.28"
    .replace(/\b(32|64)[-\s]?bit\b/gi, ' ')
    .replace(/[-–—_]+/g, ' ');
}

// "FreeDownloadManager" -> "free download manager", so camel-cased winget ids
// tokenise the same way the spaced-out registry display names do.
function splitCamel(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function tokens(text) {
  return splitCamel(stripVersionNoise(text))
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 1 && !NOISE_WORDS.has(t));
}

// Collapsing to bare alphanumerics is what turns most of the "fuzzy" cases
// into exact ones: "Microsoft.VisualStudioCode" and "Microsoft Visual Studio
// Code" are the same string once separators are gone.
function squash(text) {
  return stripVersionNoise(text).toLowerCase().replace(/[^a-z0-9+]/g, '');
}

function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const bagB = new Map();
  b.forEach((t) => bagB.set(t, (bagB.get(t) || 0) + 1));
  let shared = 0;
  for (const t of a) {
    const n = bagB.get(t);
    if (n) { shared += 1; bagB.set(t, n - 1); }
  }
  return (2 * shared) / (a.length + b.length);
}

// One string sitting inside the other, scored by how much of the longer one
// it covers. Short needles are rejected outright — "git" is a substring of
// "logitech" and that is exactly the kind of match we must not make.
function containment(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return 0;
  return long.includes(short) ? short.length / long.length : 0;
}

const MIN_DICE = 0.7;
const MIN_CONTAINMENT = 0.6;

// squash() deletes digits, which is what lets "Anaconda3 2025.06-0 (Python
// 3.13.5)" match "Anaconda.Anaconda3" — but it also makes 4.6 and 4.8 look
// identical. So version numbers are compared separately: when both sides
// state one and they disagree, it's a different build of the same product.
function versionsOf(text) {
  return text.match(/\b\d+(?:\.\d+)*\b/g) || [];
}

function versionConflict(itemText, entryText) {
  const a = versionsOf(itemText);
  const b = versionsOf(entryText);
  if (!a.length || !b.length) return false; // only one side is specific — no evidence of conflict
  return !a.some((x) => b.some((y) => x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`)));
}

// Reads Add/Remove Programs. Returns [] on non-Windows or if the query fails,
// so a missing registry never breaks a scan.
async function readInstalledSizes() {
  if (process.platform !== 'win32') return [];
  const raw = await execSafe(PS_QUERY, { timeout: 45000 });
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((r) => r && r.name)
    .map((r) => ({
      name: r.name,
      key: r.key || '',
      // EstimatedSize is a DWORD in KB, and it is itself the installer's own
      // estimate — treat it as approximate even when the name match is exact.
      bytes: Number.isFinite(r.kb) && r.kb > 0 ? r.kb * 1024 : null,
      location: r.loc || null,
      squashedName: squash(r.name),
      squashedKey: squash(r.key || ''),
      tokens: tokens(r.name),
    }));
}

// Candidate strings for an item, best first. winget ids that begin with
// "ARP\Machine\X64\..." are literally registry key names — those join exactly
// and never need fuzzy matching at all.
function itemKeys(item) {
  const bare = String(item.id).replace(/^[^:]+:/, '');
  const keys = [];

  if (/^(ARP|MSIX)\\/i.test(bare)) {
    keys.push({ text: bare.split('\\').pop(), registryKey: true });
    return keys;
  }

  const dotted = bare.split('.');
  if (dotted.length > 1) keys.push({ text: dotted.slice(1).join(' ') });
  keys.push({ text: bare.replace(/\./g, ' ') });
  if (item.name && item.name !== bare) keys.push({ text: item.name });
  return keys;
}

// Every entry an item could plausibly be, best first.
function rankMatches(item, entries) {
  const bare = String(item.id).replace(/^[^:]+:/, '');
  const keys = itemKeys(item);
  const byEntry = new Map();

  for (const key of keys) {
    const squashed = squash(key.text);
    const toks = tokens(key.text);
    if (!squashed) continue;

    entries.forEach((entry, index) => {
      if (!entry.bytes && !entry.location) return;

      let score = 0;
      let confidence = 'fuzzy';

      if (key.registryKey && entry.squashedKey && squashed === entry.squashedKey) {
        // An "ARP\Machine\X64\..." id *is* the registry key — a literal join,
        // so the version guard below doesn't apply to it.
        score = 1;
        confidence = 'exact';
      } else if (versionConflict(bare, entry.name)) {
        return;
      } else if (squashed === entry.squashedName || (entry.squashedKey && squashed === entry.squashedKey)) {
        score = 1;
        confidence = 'exact';
      } else {
        const d = dice(toks, entry.tokens);
        const c = containment(squashed, entry.squashedName);
        score = Math.max(d >= MIN_DICE ? d : 0, c >= MIN_CONTAINMENT ? c : 0);
      }

      if (score <= 0) return;
      // Identical token bags ("LocalSend" vs "LocalSend version 1.16.1") mean
      // the names agree on every meaningful word — that is an exact match that
      // only looked fuzzy because of a version suffix.
      if (score === 1) confidence = 'exact';

      const prev = byEntry.get(index);
      if (!prev || score > prev.score) byEntry.set(index, { index, entry, score, confidence });
    });
  }

  return [...byEntry.values()].sort((a, b) => b.score - a.score);
}

function bestMatch(item, entries) {
  return rankMatches(item, entries)[0] || null;
}

// Attaches sizes in place. Items that already carry a measured size (portable
// folders walked on disk) are left alone — a real measurement beats a joined
// estimate every time.
async function attachRegistrySizes(items, { deepSizeScan = false, progressCb = () => {} } = {}) {
  if (process.platform !== 'win32') return items;

  progressCb('Reading install sizes from Add/Remove Programs…');
  const entries = await readInstalledSizes();
  if (!entries.length) {
    progressCb('  (no install sizes available from the registry)');
    return items;
  }

  // Assignment is global and one-to-one. Matching each item independently let
  // six WindowsAppRuntime versions all claim the single "Windows Desktop
  // Runtime" row, counting 90MB six times over. Strongest claim wins the row;
  // the rest report no size, which is the honest answer for them.
  const candidates = [];
  items.forEach((item, itemIndex) => {
    if (item.bytes || item.type === 'manual-note') return;
    rankMatches(item, entries).forEach((m) => candidates.push({ ...m, itemIndex }));
  });
  candidates.sort((a, b) => b.score - a.score);

  const takenItems = new Set();
  const takenEntries = new Set();
  const assigned = [];
  for (const c of candidates) {
    if (takenItems.has(c.itemIndex) || takenEntries.has(c.index)) continue;
    takenItems.add(c.itemIndex);
    takenEntries.add(c.index);
    assigned.push(c);
  }

  let exact = 0;
  let fuzzy = 0;

  for (const match of assigned) {
    const item = items[match.itemIndex];
    let bytes = match.entry.bytes;

    // Some entries record a location but no size. Walking it is accurate but
    // slow, so it only happens when the user asked for measured sizes.
    if (!bytes && deepSizeScan && match.entry.location) {
      progressCb(`Measuring ${match.entry.name}…`);
      try {
        const result = await estimateFolderSize(match.entry.location);
        bytes = result.bytes || null;
      } catch {
        bytes = null;
      }
    }

    if (!bytes) continue;

    item.bytes = bytes;
    item.bytesSource = match.confidence === 'exact' ? 'registry' : 'registry-fuzzy';
    item.bytesMatchedName = match.entry.name;
    if (match.confidence === 'exact') exact += 1; else fuzzy += 1;
  }

  progressCb(`Sizes: ${exact} matched exactly, ${fuzzy} inferred by name (shown with ≈).`);
  return items;
}

module.exports = { readInstalledSizes, attachRegistrySizes, bestMatch, rankMatches, squash, tokens };
