const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSafe } = require('./utils');

// Returns { cmd, needsElevation } for removing an item, or null when there's
// no safe automatic route (the UI then shows manual guidance instead).
function getUninstallCommand(item) {
  switch (item.source) {
    case 'npm':      return { cmd: `npm uninstall -g ${item.name}`, needsElevation: false };
    case 'pip':      return { cmd: `pip uninstall -y ${item.name}`, needsElevation: false };
    case 'vscode':   return { cmd: `code --uninstall-extension ${item.name}`, needsElevation: false };
    case 'ollama':   return { cmd: `ollama rm ${item.name}`, needsElevation: false };
    case 'cargo':    return { cmd: `cargo uninstall ${item.name}`, needsElevation: false };
    case 'dotnet':   return { cmd: `dotnet tool uninstall --global ${item.name}`, needsElevation: false };
    case 'gem':      return { cmd: `gem uninstall ${item.name} -x -I`, needsElevation: false };
    case 'brew':     return { cmd: `brew uninstall ${item.name}`, needsElevation: false };
    case 'brew-cask':return { cmd: `brew uninstall --cask ${item.name}`, needsElevation: false };
    case 'flatpak':  return { cmd: `flatpak uninstall -y ${item.name}`, needsElevation: false };
    case 'winget':   return { cmd: `winget uninstall --id ${item.name} -e --disable-interactivity`, needsElevation: true };
    case 'choco':    return { cmd: `choco uninstall ${item.name} -y`, needsElevation: true };
    case 'apt':      return { cmd: `apt remove -y ${item.name}`, needsElevation: true };
    case 'snap':     return { cmd: `snap remove ${item.name}`, needsElevation: true };
    default:         return null;
  }
}

// Best-effort: executables sitting in common install folders that no package
// manager claims. Can't be exhaustive — there's no OS-level record of a
// script that curls a binary into place — but it surfaces likely candidates.
async function scanUnmanagedBinaries() {
  if (process.platform === 'win32') return []; // diffing Program Files vs winget is too noisy to trust

  const dirs = ['/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), '/opt'];
  const isMac = process.platform === 'darwin';
  const results = [];

  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    // Cap the work — /opt on a busy machine can be large and this is only a hint.
    for (const name of entries.slice(0, 200)) {
      const fullPath = path.join(dir, name);
      let owned = false;

      if (isMac) {
        try {
          const real = fs.realpathSync(fullPath);
          owned = real.includes('/Cellar/') || real.includes('/opt/homebrew/');
        } catch {
          owned = false;
        }
      } else {
        // dpkg -S answers "which installed package owns this file"
        const dpkgResult = await execSafe(`dpkg -S "${fullPath}"`);
        owned = !!dpkgResult;
      }

      if (!owned) {
        results.push({
          id: `unmanaged:${fullPath}`,
          name,
          category: 'Unmanaged binaries (unknown origin)',
          source: 'unmanaged',
          path: fullPath,
          version: '',
          type: 'manual-note',
          portable: false,
          installCmd: null,
          note: `No package manager claims ${fullPath}. It was probably installed by a script or manual download — check how you originally got it and repeat that on the new machine.`,
        });
      }
    }
  }
  return results;
}

module.exports = { getUninstallCommand, scanUnmanagedBinaries };
