const os = require('os');
const path = require('path');
const { execSafe, dirExists } = require('./utils');

// These tools behave the same regardless of OS, so one scanner covers
// Windows, macOS, and Linux. Everything here is genuinely cross-platform:
// items from this file can be restored on any target OS.

async function scanNpmGlobals() {
  const out = await execSafe('npm list -g --depth=0 --json');
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    const deps = parsed.dependencies || {};
    return Object.entries(deps)
      // npm itself is bundled with Node; reinstalling it globally is a no-op at best
      .filter(([name]) => name !== 'npm')
      .map(([name, info]) => ({
        id: `npm:${name}`,
        name,
        category: 'Global npm packages',
        source: 'npm',
        version: info.version || '',
        type: 'package',
        portable: true,
        installCmd: `npm install -g ${name}`,
        pinnedInstallCmd: info.version ? `npm install -g ${name}@${info.version}` : null,
      }));
  } catch {
    return [];
  }
}

async function scanPip() {
  // --not-required gives top-level packages only, skipping the transitive
  // dependencies that pip will reinstall automatically anyway. Reinstalling
  // the full freeze list globally is both slow and often conflicting.
  const pipBin = (await execSafe('pip3 --version')) ? 'pip3' : 'pip';
  const out = await execSafe(`${pipBin} list --not-required --format=freeze`);
  if (!out) return [];

  // If a virtualenv is active, this list describes that env, not the system
  // Python — worth flagging rather than silently capturing the wrong thing.
  const inVenv = !!process.env.VIRTUAL_ENV || !!process.env.CONDA_PREFIX;
  const venvNote = inVenv ? ' (captured from an active virtualenv)' : '';

  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.includes('=='))
    .map((line) => {
      const [name, version] = line.split('==');
      return {
        id: `pip:${name}`,
        name,
        category: `Global pip packages${venvNote}`,
        source: 'pip',
        version: version || '',
        type: 'package',
        portable: true,
        installCmd: `pip install ${name}`,
        pinnedInstallCmd: version ? `pip install ${name}==${version}` : null,
      };
    });
}

async function scanVSCodeExtensions() {
  const out = await execSafe('code --list-extensions --show-versions');
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const atIndex = line.lastIndexOf('@');
      const id = atIndex > -1 ? line.slice(0, atIndex) : line;
      const version = atIndex > -1 ? line.slice(atIndex + 1) : '';
      return {
        id: `vscode:${id}`,
        name: id,
        category: 'VS Code extensions',
        source: 'vscode',
        version,
        type: 'package',
        portable: true,
        installCmd: `code --install-extension ${id}`,
        pinnedInstallCmd: null,
      };
    });
}

async function scanOllamaModels() {
  const out = await execSafe('ollama list');
  if (!out) return [];
  return out
    .split('\n')
    .slice(1) // header row: NAME / ID / SIZE / MODIFIED
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(/\s{2,}/);
      const name = cols[0];
      // Column order is NAME, ID, SIZE — pick the one that looks like a size
      const size = cols.find((c) => /^[\d.]+\s*[KMGT]B$/i.test(c.trim())) || '';
      return {
        id: `ollama:${name}`,
        name,
        category: 'Ollama models',
        source: 'ollama',
        version: size,
        type: 'package',
        portable: true,
        installCmd: `ollama pull ${name}`,
        pinnedInstallCmd: null,
      };
    })
    .filter((item) => item.name);
}

async function scanCargo() {
  const out = await execSafe('cargo install --list');
  if (!out) return [];
  const items = [];
  // Format: "name v1.2.3:" followed by indented binary names
  for (const line of out.split('\n')) {
    const match = line.match(/^(\S+)\s+v(\S+):/);
    if (match) {
      items.push({
        id: `cargo:${match[1]}`,
        name: match[1],
        category: 'Cargo (Rust) binaries',
        source: 'cargo',
        version: match[2],
        type: 'package',
        portable: true,
        installCmd: `cargo install ${match[1]}`,
        pinnedInstallCmd: `cargo install ${match[1]} --version ${match[2]}`,
      });
    }
  }
  return items;
}

async function scanGoBinaries() {
  // Go has no "list installed binaries" command, so read GOBIN/GOPATH/bin.
  // Names alone don't give install paths, so these are listed as notes.
  const gopath = (await execSafe('go env GOPATH')) || path.join(os.homedir(), 'go');
  const gobin = (await execSafe('go env GOBIN')) || path.join(gopath, 'bin');
  if (!dirExists(gobin)) return [];
  const fs = require('fs');
  let entries;
  try {
    entries = fs.readdirSync(gobin);
  } catch {
    return [];
  }
  return entries.map((name) => ({
    id: `go:${name}`,
    name,
    category: 'Go binaries',
    source: 'go',
    version: '',
    type: 'manual-note',
    portable: true,
    installCmd: null,
    note: `Reinstall with: go install <module-path>@latest (module path not recorded by Go itself)`,
  }));
}

async function scanDotnetTools() {
  const out = await execSafe('dotnet tool list --global');
  if (!out) return [];
  return out
    .split('\n')
    .slice(2) // header + separator row
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(/\s{2,}/);
      const name = cols[0];
      return {
        id: `dotnet:${name}`,
        name,
        category: '.NET global tools',
        source: 'dotnet',
        version: cols[1] || '',
        type: 'package',
        portable: true,
        installCmd: `dotnet tool install --global ${name}`,
        pinnedInstallCmd: null,
      };
    })
    .filter((i) => i.name);
}

async function scanGems() {
  const out = await execSafe('gem list --local --no-versions');
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('***'))
    .map((name) => ({
      id: `gem:${name}`,
      name,
      category: 'Ruby gems',
      source: 'gem',
      version: '',
      type: 'package',
      portable: true,
      installCmd: `gem install ${name}`,
      pinnedInstallCmd: null,
    }));
}

async function scanCondaEnvs() {
  const out = await execSafe('conda env list --json');
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    return (parsed.envs || [])
      .map((envPath) => path.basename(envPath))
      .filter((name) => name && name !== 'base')
      .map((name) => ({
        id: `conda:${name}`,
        name,
        category: 'Conda environments',
        source: 'conda',
        version: '',
        type: 'manual-note',
        portable: true,
        installCmd: null,
        note: `Export it properly with: conda env export -n ${name} > ${name}.yml — then recreate with conda env create -f ${name}.yml`,
      }));
  } catch {
    return [];
  }
}

module.exports = {
  scanNpmGlobals,
  scanPip,
  scanVSCodeExtensions,
  scanOllamaModels,
  scanCargo,
  scanGoBinaries,
  scanDotnetTools,
  scanGems,
  scanCondaEnvs,
};
