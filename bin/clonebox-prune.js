#!/usr/bin/env node
/**
 * clonebox-prune — what's installed that nothing in your life references?
 *
 * Not a disk-usage tool. WizTree already tells you what's large. This asks a
 * different question: which installed things are unreferenced by any project
 * on disk and unread for months. The answer needs provenance, not file sizes.
 */

const path = require('path');
const { runFullScan } = require('../src/scanners');
const { probeAtime, windowsAtimeHint, VERDICT } = require('../src/prune/atime-probe');
const { findProjects, defaultRoots } = require('../src/prune/projects');
const { analyze, summarize, V, daysAgo } = require('../src/prune/analyze');
const { scanCredentials, describeAge } = require('../src/prune/credentials');
const { formatBytes } = require('../src/scanners/utils');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i > -1 && args[i + 1] ? args[i + 1] : d;
};

if (has('--help') || has('-h')) {
  console.log(`
clonebox-prune — find installed software nothing references anymore

Usage:
  clonebox-prune [options]

Options:
  --roots <a,b,c>      Directories to search for projects (default: common dev folders)
  --stale-days <n>     Project counts as inactive after this long (default: 180)
  --unused-days <n>    Unreferenced item counts as orphaned after this long (default: 365)
  --show <verdict>     Filter output: active|stale|orphan|unknown|protected|all (default: stale,orphan)
  --json               Machine-readable output
  --sizes              Measure folder sizes (slower)
  --credentials        Audit SSH keys, tokens and secrets files (metadata only)
  --only-credentials   Run the credential audit alone, skipping the package scan
  --help               This message

Nothing is ever deleted. This tool only reports.
Credential values are never read, stored, or printed — only metadata.
`);
  process.exit(0);
}

const asJson = has('--json');
const log = (...a) => { if (!asJson) console.log(...a); };

const COLORS = {
  active: '\x1b[32m', stale: '\x1b[33m', orphan: '\x1b[31m',
  unknown: '\x1b[90m', protected: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m',
};
const paint = (t, c) => (process.stdout.isTTY && !asJson ? `${COLORS[c] || ''}${t}${COLORS.reset}` : t);

const credentialsOnly = has('--only-credentials');
const wantCredentials = has('--credentials') || credentialsOnly;

function reportCredentials(cred) {
  log(paint('\n== Credential surface ==', 'bold'));
  log(paint('  Values are never read or stored. This reports metadata only.', 'unknown'));

  const section = (title, rows, render) => {
    if (!rows.length) return;
    log(paint(`\n-- ${title} (${rows.length}) --`, 'bold'));
    rows.forEach(render);
  };

  section('SSH keys', cred.sshKeys, (k) => {
    const flag = k.concerns.length ? 'stale' : 'active';
    log(`  ${paint(k.label, flag)}  ${paint(`${k.algorithm}${k.bits ? ' ' + k.bits + '-bit' : ''}, ${describeAge(k.ageDays)}`, 'unknown')}`);
    if (k.comment) log(`      comment: ${k.comment}`);
    if (!k.referenced) log(`      ${paint(k.referenceNote, 'unknown')}`);
    k.concerns.forEach((c) => log(`      ${paint('!', 'stale')} ${c}`));
  });

  section('Credentials embedded in git remotes', cred.remotes, (r) => {
    log(`  ${paint(r.label, 'orphan')}`);
    r.concerns.forEach((c) => log(`      ${paint('!', 'orphan')} ${c}`));
  });

  section('Tool credential files', cred.files, (f) => {
    const flag = f.concerns.length ? 'stale' : 'active';
    log(`  ${paint(f.label, flag)}  ${paint(describeAge(f.ageDays), 'unknown')}`);
    log(`      ${f.path}`);
    if (f.accounts.length) log(`      accounts: ${f.accounts.join(', ')}`);
    f.concerns.forEach((c) => log(`      ${paint('!', 'stale')} ${c}`));
    if (f.concerns.length) log(`      revoke: ${f.revoke}`);
  });

  section('Secrets files in projects', cred.envs, (e) => {
    const flag = e.concerns.length ? 'stale' : 'unknown';
    log(`  ${paint(e.label, flag)}  ${paint(e.note, 'unknown')}`);
    e.concerns.forEach((c) => log(`      ${paint('!', 'stale')} ${c}`));
  });

  const total = cred.sshKeys.length + cred.remotes.length + cred.files.length + cred.envs.length;
  if (!total) log('  Nothing found. Either this machine is clean, or credentials live somewhere non-standard.');

  log(paint('\n  Clonebox never transfers credentials.', 'bold'));
  log('  Generate a fresh SSH key on a new machine and re-authenticate; moving');
  log('  secrets through an archive turns a migration into a breach.');
}

(async () => {
  if (credentialsOnly) {
    const roots = val('--roots', null) ? val('--roots').split(',') : defaultRoots();
    log(paint('== Finding projects (for correlating keys to remotes) ==', 'bold'));
    const projects = await findProjects(roots, { progressCb: (m) => log(`  ${m}`) });
    log(`  Found ${projects.length} project(s).`);
    const cred = await scanCredentials(projects);
    if (asJson) {
      console.log(JSON.stringify({ credentials: cred }, null, 2));
      return;
    }
    reportCredentials(cred);
    log('');
    return;
  }

  // ---- Step 1: can we even measure "unused"? ----
  log(paint('\n== Checking whether this filesystem records file reads ==', 'bold'));
  const atime = await probeAtime();
  log(`  ${atime.verdict.toUpperCase()}: ${atime.detail}`);

  const hint = await windowsAtimeHint();
  if (hint) log(`  ${hint}`);

  if (atime.verdict === VERDICT.DISABLED) {
    log(paint('\n  Age-based detection is unavailable on this machine.', 'stale'));
    log('  Results will rely on project references alone, which cannot distinguish');
    log('  "installed and forgotten" from "installed and used outside any project".');
  }

  // ---- Step 2: what's installed ----
  log(paint('\n== Scanning installed software ==', 'bold'));
  const scan = await runFullScan({
    deepSizeScan: has('--sizes'),
    progressCb: (m) => log(`  ${m}`),
  });

  // ---- Step 3: what do your projects actually reference ----
  log(paint('\n== Finding projects and what they declare ==', 'bold'));
  const roots = val('--roots', null) ? val('--roots').split(',') : defaultRoots();
  const projects = await findProjects(roots, { progressCb: (m) => log(`  ${m}`) });
  log(`  Found ${projects.length} project(s).`);

  if (projects.length === 0) {
    log(paint('\n  No projects found — every result would be "unreferenced", which is', 'stale'));
    log('  meaningless. Point --roots at where your code actually lives.');
  }

  const declaredTotal = new Set(projects.flatMap((p) => p.declared)).size;
  log(`  ${declaredTotal} distinct dependency names declared across them.`);

  // ---- Step 4: join it together ----
  const results = await analyze(scan.items, projects, atime.verdict, {
    staleAfterDays: Number(val('--stale-days', 180)),
    unusedAfterDays: Number(val('--unused-days', 365)),
  });
  const summary = summarize(results);

  const credentials = wantCredentials ? await scanCredentials(projects) : null;

  if (asJson) {
    console.log(JSON.stringify({
      atime, projectCount: projects.length, credentials,
      projects: projects.map((p) => ({ path: p.path, name: p.name, lastActivity: p.lastActivity })),
      summary, results,
    }, null, 2));
    return;
  }

  // ---- Step 5: report ----
  log(paint('\n== Results ==', 'bold'));
  log(`  ${paint('active', 'active')}    ${summary.counts.active}\tused by a project you've touched recently`);
  log(`  ${paint('stale', 'stale')}     ${summary.counts.stale}\tonly used by projects that have gone quiet`);
  log(`  ${paint('orphan', 'orphan')}    ${summary.counts.orphan}\tnothing references it and nothing has read it`);
  log(`  ${paint('unknown', 'unknown')}   ${summary.counts.unknown}\tnot enough signal — never recommended for removal`);
  log(`  ${paint('protected', 'protected')} ${summary.counts.protected}\tcore system/toolchain, excluded by design`);

  if (summary.reclaimableBytes) {
    log(`\n  Measured size of stale+orphan items: ${formatBytes(summary.reclaimableBytes)}`);
    log('  (run with --sizes for folder measurements)');
  }

  const showArg = val('--show', 'stale,orphan');
  const show = showArg === 'all'
    ? Object.values(V)
    : showArg.split(',').map((s) => s.trim());

  for (const verdict of show) {
    const group = results.filter((r) => r.verdict === verdict);
    if (!group.length) continue;
    log(paint(`\n-- ${verdict} (${group.length}) --`, verdict));
    group
      .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
      .slice(0, 40)
      .forEach((r) => {
        const size = r.bytes ? ` [${formatBytes(r.bytes)}]` : '';
        log(`  ${r.name}${size}  ${paint(`(${r.source}, confidence: ${r.confidence})`, 'unknown')}`);
        r.reasons.forEach((reason) => log(`      ${reason}`));
      });
    if (group.length > 40) log(`  …and ${group.length - 40} more (use --json for the full list)`);
  }

  if (credentials) reportCredentials(credentials);

  log(paint('\n== Caveats ==', 'bold'));
  log('  Nothing was deleted; this tool only reports.');
  if (atime.verdict === VERDICT.COARSE) {
    log('  relatime gives ~24h granularity — fine for "months unused", not for recent activity.');
  }
  log('  A tool used only from the shell (never named in a manifest) can look unreferenced.');
  log('  Check anything before acting on it. "unknown" means genuinely unknown, not "safe".');
  log('');
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
