const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execSafe } = require('./utils');

// winget export requires a real file path — passing "-o -" for stdout does
// not work and silently fails. Export to a temp file, read it, clean up.
async function scanWinget() {
  const tmpFile = path.join(os.tmpdir(), `clonebox-winget-${Date.now()}.json`);
  await execSafe(
    `winget export -o "${tmpFile}" --accept-source-agreements --disable-interactivity`,
    { timeout: 90000 }
  );

  let raw = null;
  try {
    raw = await fsp.readFile(tmpFile, 'utf8');
  } catch {
    raw = null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* already gone */ }
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const pkgs = (parsed.Sources || []).flatMap((s) => s.Packages || []);
      if (pkgs.length) {
        return pkgs.map((p) => ({
          id: `winget:${p.PackageIdentifier}`,
          name: p.PackageIdentifier,
          category: 'Windows applications (winget)',
          source: 'winget',
          version: p.Version || '',
          type: 'package',
          portable: false, // Windows-only; no automatic brew/apt equivalent
          sourcePlatform: 'win32',
          installCmd: `winget install --id ${p.PackageIdentifier} -e --accept-package-agreements --accept-source-agreements`,
          pinnedInstallCmd: null,
          needsElevation: true,
        }));
      }
    } catch {
      /* fall through to table parsing */
    }
  }

  // Fallback: parse `winget list` table output. Less reliable (column widths
  // shift, unicode box characters) but better than returning nothing.
  const listOut = await execSafe('winget list --accept-source-agreements --disable-interactivity');
  if (!listOut) return [];
  return listOut
    .split('\n')
    .slice(2)
    .map((l) => l.trim())
    .filter((l) => l && !/^-+$/.test(l))
    .map((line) => {
      const cols = line.split(/\s{2,}/);
      const name = cols[0] || line;
      const id = cols[1] || name;
      return {
        id: `winget:${id}`,
        name,
        category: 'Windows applications (winget)',
        source: 'winget',
        version: cols[2] || '',
        type: 'package',
        portable: false,
        sourcePlatform: 'win32',
        installCmd: `winget install --id ${id} -e --accept-package-agreements --accept-source-agreements`,
        pinnedInstallCmd: null,
        needsElevation: true,
      };
    });
}

async function scanChoco() {
  const out = await execSafe('choco list --local-only --limit-output');
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.includes('|'))
    .map((line) => {
      const [name, version] = line.split('|');
      return {
        id: `choco:${name}`,
        name,
        category: 'Windows applications (Chocolatey)',
        source: 'choco',
        version: version || '',
        type: 'package',
        portable: false,
        sourcePlatform: 'win32',
        installCmd: `choco install ${name} -y`,
        pinnedInstallCmd: version ? `choco install ${name} --version ${version} -y` : null,
        needsElevation: true,
      };
    });
}

async function scanWindowsSDK() {
  const vswherePath = '"%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe"';
  const out = await execSafe(`${vswherePath} -products * -format json`);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    return parsed.map((vs, i) => ({
      id: `vs:${vs.instanceId || i}`,
      name: `${vs.displayName || 'Visual Studio'} ${vs.installationVersion || ''}`.trim(),
      category: 'Visual Studio / Windows SDK',
      source: 'visual-studio',
      version: vs.installationVersion || '',
      type: 'manual-note',
      portable: false,
      sourcePlatform: 'win32',
      installCmd: null,
      note: 'Reinstall via the Visual Studio Installer and re-select the same workloads. Unattended install is possible with a .vsconfig export but is not scripted here.',
    }));
  } catch {
    return [];
  }
}

// A scan run from Windows cannot see inside WSL — it's a separate filesystem
// with its own package set. Detect the distros and say so explicitly rather
// than leaving the user to assume they were covered.
async function scanWSLDistros() {
  const out = await execSafe('wsl --list --quiet');
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.replace(/\0/g, '').trim()) // wsl outputs UTF-16, nulls survive
    .filter(Boolean)
    .map((name) => ({
      id: `wsl:${name}`,
      name: `${name} (WSL distro — not scanned)`,
      category: 'WSL distros (separate scan needed)',
      source: 'wsl',
      version: '',
      type: 'manual-note',
      portable: false,
      sourcePlatform: 'win32',
      installCmd: null,
      note: `This scan only covers Windows. To capture what's installed inside ${name}, run Clonebox from within that distro — its apt/npm/pip packages are entirely separate from Windows.`,
    }));
}

module.exports = { scanWinget, scanChoco, scanWindowsSDK, scanWSLDistros };
