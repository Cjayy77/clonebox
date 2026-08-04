const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const archiver = require('archiver');
const { getFreeSpace, formatBytes } = require('../scanners/utils');
const { buildPowerShellInstaller, buildBashInstaller } = require('./installers');
const { buildEquivalents, tableSize } = require('./equivalents');

const MANIFEST_SCHEMA_VERSION = 2;

function zipFolder(sourceDir, outFile, { skipDirs = [], progressCb } = {}) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('warning', (err) => {
      // ENOENT here means a file vanished mid-zip (common with caches) — not fatal
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
    if (progressCb) archive.on('progress', progressCb);

    archive.pipe(output);
    archive.glob('**/*', {
      cwd: sourceDir,
      dot: true,
      ignore: skipDirs.flatMap((d) => [`${d}/**`, `**/${d}/**`]),
    });
    archive.finalize();
  });
}

// Human-readable summary of what will NOT survive a move to a different OS,
// written into the package so it's visible before arriving at the new machine.
function buildCrossPlatformReport(items, sourcePlatform) {
  const OS_LABELS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const others = Object.keys(OS_LABELS).filter((os) => os !== sourcePlatform);

  const lines = [
    '# Clonebox — cross-platform compatibility report',
    '',
    `Captured on: ${OS_LABELS[sourcePlatform] || sourcePlatform}`,
    `Equivalence table: ${tableSize()} tools with verified per-OS mappings.`,
    '',
  ];

  const packages = items.filter((i) => i.type === 'package');
  const folders = items.filter((i) => i.type === 'portable-folder');
  const notes = items.filter((i) => i.type === 'manual-note');

  // Bucket 1: works everywhere as-is
  const universal = packages.filter((i) => i.portable);
  lines.push(
    `## Installs directly on any OS (${universal.length})`,
    'These package managers exist on every platform; the commands are identical.',
    '',
    ...universal.map((i) => `  - ${i.name} (${i.source})`),
    ''
  );

  // Buckets 2 and 3, per target OS
  for (const os of others) {
    const osLocked = packages.filter((i) => !i.portable);
    const mapped = osLocked.filter((i) => i.equivalents && i.equivalents[os] && i.equivalents[os].cmd);
    const noEquivalent = osLocked.filter(
      (i) => !i.equivalents || !i.equivalents[os] || !i.equivalents[os].cmd
    );
    const mappedFolders = folders.filter(
      (i) => i.equivalents && i.equivalents[os] && i.equivalents[os].cmd
    );

    lines.push(
      `## On ${OS_LABELS[os]}: ${mapped.length + mappedFolders.length} verified equivalents available`,
      'The installer will install these using the native package manager and tell',
      'you it substituted an equivalent rather than the original package.',
      ''
    );
    for (const i of [...mapped, ...mappedFolders]) {
      const eq = i.equivalents[os];
      lines.push(`  - ${i.name}  ->  ${eq.cmd}`);
      if (eq.note) lines.push(`      note: ${eq.note}`);
    }
    lines.push('');

    lines.push(
      `## On ${OS_LABELS[os]}: ${noEquivalent.length} with no known equivalent`,
      'Not in the equivalence table, or genuinely platform-exclusive. These are',
      'skipped rather than guessed at — a near-miss name match installs the wrong',
      'software, which is worse than installing nothing.',
      ''
    );
    for (const i of noEquivalent) {
      const eqNote = i.equivalents && i.equivalents[os] && i.equivalents[os].note;
      lines.push(`  - ${i.name} (${i.source})`);
      if (eqNote) lines.push(`      note: ${eqNote}`);
    }
    lines.push('');
  }

  lines.push(
    `## Folder copies — same-OS only (${folders.length})`,
    'Compiled binaries. On a different OS the installer uses the equivalent above',
    'if one exists, or a version manager (fvm/nvm) at the recorded version.',
    '',
    ...folders.map((i) => `  - ${i.name}${i.version ? ` [${i.version}]` : ''}`),
    '',
    `## Manual attention (${notes.length})`,
    '',
    ...notes.map((i) => `  - ${i.name}${i.note ? `\n      ${i.note}` : ''}`),
    ''
  );

  return lines.join('\n');
}

async function packageSelection(
  selectedItems,
  outDir,
  { progressCb = () => {}, usePinnedVersions = false, equivalentPolicy = 'ask' } = {}
) {
  await fsp.mkdir(outDir, { recursive: true });

  const folderItems = selectedItems.filter((i) => i.type === 'portable-folder');

  // Refuse to start a huge zip onto a drive that can't hold it, rather than
  // failing halfway and leaving a corrupt archive.
  const knownBytes = folderItems.reduce((sum, i) => sum + (i.bytes || 0), 0);
  if (knownBytes > 0) {
    const free = await getFreeSpace(outDir);
    if (free !== null && free < knownBytes * 1.1) {
      throw new Error(
        `Not enough free space at destination. Need roughly ${formatBytes(knownBytes)}, only ${formatBytes(free)} available.`
      );
    }
  }

  const sdkDir = path.join(outDir, 'sdks');
  const manifestItems = [];

  for (const item of selectedItems) {
    if (item.type === 'portable-folder') {
      await fsp.mkdir(sdkDir, { recursive: true });
      const zipName = `${item.id.replace(/[^a-z0-9-_]/gi, '_')}.zip`;
      const zipPath = path.join(sdkDir, zipName);
      progressCb(`Zipping ${item.name}… (large SDKs can take several minutes)`);
      const written = await zipFolder(item.path, zipPath, {
        skipDirs: item.skipDirs || [],
        progressCb: (p) => progressCb(`  ${item.name}: ${p.entries.processed} files packed`),
      });
      progressCb(`  ${item.name} done — ${formatBytes(written)} archive`);
      manifestItems.push({
        ...item,
        zipFile: `sdks/${zipName}`,
        originalPath: item.path,
        path: undefined,
        equivalents: item.equivalents || buildEquivalents(item),
      });
    } else {
      const chosenCmd =
        usePinnedVersions && item.pinnedInstallCmd ? item.pinnedInstallCmd : item.installCmd;
      manifestItems.push({ ...item, installCmd: chosenCmd, equivalents: item.equivalents || buildEquivalents(item) });
    }
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    sourcePlatform: process.platform,
    usePinnedVersions,
    // 'ask'    — installer prompts per substitution (default)
    // 'always' — substitute silently, still logged as [OK-EQUIV]
    // 'never'  — never substitute; report and skip
    equivalentPolicy,
    items: manifestItems,
  };

  await fsp.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(outDir, 'install.ps1'), buildPowerShellInstaller());
  await fsp.writeFile(path.join(outDir, 'install.sh'), buildBashInstaller());
  await fsp.writeFile(
    path.join(outDir, 'COMPATIBILITY.md'),
    buildCrossPlatformReport(manifestItems, process.platform)
  );

  try {
    await fsp.chmod(path.join(outDir, 'install.sh'), 0o755);
  } catch {
    /* chmod unavailable on this filesystem (e.g. exFAT) — the README covers it */
  }

  progressCb('Package ready.');
  return { outDir, itemCount: manifestItems.length, folderCount: folderItems.length };
}

module.exports = { packageSelection };
