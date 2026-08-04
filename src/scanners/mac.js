const { execSafe } = require('./utils');

async function scanHomebrew() {
  const [formulae, casks] = await Promise.all([
    execSafe('brew leaves --installed-on-request'), // top-level only, skips auto-installed deps
    execSafe('brew list --cask'),
  ]);
  const items = [];

  if (formulae) {
    formulae.split('\n').map((l) => l.trim()).filter(Boolean).forEach((name) => {
      items.push({
        id: `brew:${name}`,
        name,
        category: 'Homebrew formulae',
        source: 'brew',
        version: '',
        type: 'package',
        portable: false, // macOS-only
        sourcePlatform: 'darwin',
        installCmd: `brew install ${name}`,
        pinnedInstallCmd: null,
      });
    });
  }

  if (casks) {
    casks.split('\n').map((l) => l.trim()).filter(Boolean).forEach((name) => {
      items.push({
        id: `brew-cask:${name}`,
        name,
        category: 'Homebrew casks (apps)',
        source: 'brew-cask',
        version: '',
        type: 'package',
        portable: false,
        sourcePlatform: 'darwin',
        installCmd: `brew install --cask ${name}`,
        pinnedInstallCmd: null,
      });
    });
  }

  return items;
}

module.exports = { scanHomebrew };
