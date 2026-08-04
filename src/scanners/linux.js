const { execSafe } = require('./utils');

async function scanApt() {
  // showmanual lists only explicitly-installed packages, skipping the
  // hundreds of auto-pulled dependencies.
  const out = await execSafe('apt-mark showmanual');
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((name) => ({
      id: `apt:${name}`,
      name,
      category: 'APT packages (manually installed)',
      source: 'apt',
      version: '',
      type: 'package',
      portable: false, // Debian/Ubuntu-only
      sourcePlatform: 'linux',
      installCmd: `apt install -y ${name}`,
      pinnedInstallCmd: null,
      needsElevation: true,
    }));
}

async function scanSnap() {
  const out = await execSafe('snap list');
  if (!out) return [];
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(/\s+/);
      return {
        id: `snap:${cols[0]}`,
        name: cols[0],
        category: 'Snap packages',
        source: 'snap',
        version: cols[1] || '',
        type: 'package',
        portable: false,
        sourcePlatform: 'linux',
        installCmd: `snap install ${cols[0]}`,
        pinnedInstallCmd: null,
        needsElevation: true,
      };
    })
    .filter((i) => i.name);
}

async function scanFlatpak() {
  const out = await execSafe('flatpak list --app --columns=application');
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((appId) => ({
      id: `flatpak:${appId}`,
      name: appId,
      category: 'Flatpak apps',
      source: 'flatpak',
      version: '',
      type: 'package',
      portable: false,
      sourcePlatform: 'linux',
      installCmd: `flatpak install -y flathub ${appId}`,
      pinnedInstallCmd: null,
    }));
}

module.exports = { scanApt, scanSnap, scanFlatpak };
