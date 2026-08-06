const os = require('os');
const universal = require('./universal');
const { scanPortableSDKs } = require('./portable');
const { scanUnmanagedBinaries } = require('./uninstall');
const { buildEquivalents } = require('../packager/equivalents');

function describePlatform(p) {
  if (p === 'win32') return 'Windows';
  if (p === 'darwin') return 'macOS';
  if (p === 'linux') return 'Linux';
  return p;
}

// Two scanners can surface the same underlying tool (e.g. node via both
// winget and nvm). Keep the first occurrence so the list stays honest about
// count without showing obvious duplicates.
function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runFullScan({ deepSizeScan = false, progressCb = () => {} } = {}) {
  const items = [];
  const platform = process.platform;

  // Each probe is wrapped so one failing tool never aborts the whole scan.
  const step = async (label, fn) => {
    progressCb(label);
    try {
      const result = await fn();
      if (result && result.length) items.push(...result);
    } catch (err) {
      progressCb(`  (skipped — ${err.message})`);
    }
  };

  await step('Scanning global npm packages…', universal.scanNpmGlobals);
  await step('Scanning pip packages…', universal.scanPip);
  await step('Scanning VS Code extensions…', universal.scanVSCodeExtensions);
  await step('Scanning Ollama models…', universal.scanOllamaModels);
  await step('Scanning Cargo binaries…', universal.scanCargo);
  await step('Scanning Go binaries…', universal.scanGoBinaries);
  await step('Scanning .NET global tools…', universal.scanDotnetTools);
  await step('Scanning Ruby gems…', universal.scanGems);
  await step('Scanning Conda environments…', universal.scanCondaEnvs);

  await step('Looking for portable SDKs and caches…', () =>
    scanPortableSDKs({ deepSizeScan, progressCb })
  );

  if (platform === 'win32') {
    const win = require('./windows');
    await step('Scanning winget packages…', win.scanWinget);
    await step('Scanning Chocolatey packages…', win.scanChoco);
    await step('Scanning Visual Studio / Windows SDK…', win.scanWindowsSDK);
    await step('Checking for WSL distros…', win.scanWSLDistros);
  } else if (platform === 'darwin') {
    const mac = require('./mac');
    await step('Scanning Homebrew…', mac.scanHomebrew);
  } else if (platform === 'linux') {
    const linux = require('./linux');
    await step('Scanning apt packages…', linux.scanApt);
    await step('Scanning snap packages…', linux.scanSnap);
    await step('Scanning flatpak apps…', linux.scanFlatpak);
  }

  await step('Checking for binaries not owned by any package manager…', scanUnmanagedBinaries);

  // Attach cross-OS equivalents now so the UI can show, before packaging,
  // which items have a verified substitute on the target OS.
  const deduped = dedupe(items).map((item) => ({
    ...item,
    equivalents: buildEquivalents(item),
  }));

  // Package managers don't report install sizes; Windows records them in the
  // Add/Remove Programs registry under a different name, so this joins the two.
  if (platform === 'win32') {
    const { attachRegistrySizes } = require('./windows-sizes');
    try {
      await attachRegistrySizes(deduped, { deepSizeScan, progressCb });
    } catch (err) {
      progressCb(`  (install sizes unavailable — ${err.message})`);
    }
  }

  const mappedCount = deduped.filter((i) => i.equivalents).length;
  progressCb(`Scan complete — ${deduped.length} items found, ${mappedCount} with known cross-OS equivalents.`);

  return {
    platform,
    platformLabel: describePlatform(platform),
    hostname: os.hostname(),
    scannedAt: new Date().toISOString(),
    items: deduped,
  };
}

module.exports = { runFullScan, describePlatform };
