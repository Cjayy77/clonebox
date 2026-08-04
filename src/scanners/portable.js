const os = require('os');
const path = require('path');
const { execSafe, dirExists, estimateFolderSize, formatBytes } = require('./utils');

const home = os.homedir();
const isWin = process.platform === 'win32';

// Directories not worth carrying to a new machine: version-control history,
// build output, and caches that regenerate on first use. Excluding .git from
// the Flutter SDK alone typically saves several GB.
const COMMON_SKIP = ['.git', '.github'];

const CANDIDATES = [
  {
    id: 'flutter-sdk',
    name: 'Flutter SDK',
    paths: isWin
      ? ['C:\\src\\flutter', 'C:\\flutter', path.join(home, 'flutter'), path.join(home, 'dev', 'flutter')]
      : [path.join(home, 'flutter'), path.join(home, 'development', 'flutter'), '/usr/local/flutter', '/opt/flutter'],
    versionCmd: 'flutter --version',
    skipDirs: [...COMMON_SKIP, '.pub-cache'],
    binSubdir: 'bin',
  },
  {
    id: 'pub-cache',
    name: 'Dart/Flutter pub cache (package downloads)',
    // Lives OUTSIDE the Flutter SDK folder, so copying the SDK alone leaves
    // every project needing a full `pub get` re-download.
    paths: isWin
      ? [path.join(process.env.LOCALAPPDATA || '', 'Pub', 'Cache'), path.join(home, '.pub-cache')]
      : [path.join(home, '.pub-cache')],
    versionCmd: null,
    skipDirs: COMMON_SKIP,
    binSubdir: null,
  },
  {
    id: 'android-sdk',
    name: 'Android SDK',
    paths: isWin
      ? [path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')]
      : [path.join(home, 'Library', 'Android', 'sdk'), path.join(home, 'Android', 'Sdk')],
    versionCmd: null,
    skipDirs: [...COMMON_SKIP, 'system-images', 'emulator'], // emulator images are huge and re-downloadable
    binSubdir: 'platform-tools',
  },
  {
    id: 'gradle-cache',
    name: 'Gradle cache',
    paths: [path.join(home, '.gradle')],
    versionCmd: null,
    skipDirs: [...COMMON_SKIP, 'daemon', 'native'],
    binSubdir: null,
  },
  {
    id: 'nvm-node-versions',
    name: 'nvm Node versions',
    paths: isWin
      ? [path.join(process.env.APPDATA || '', 'nvm')]
      : [path.join(home, '.nvm', 'versions', 'node')],
    versionCmd: 'node --version',
    skipDirs: COMMON_SKIP,
    binSubdir: null,
  },
  {
    id: 'fnm-node-versions',
    name: 'fnm Node versions',
    paths: [path.join(home, '.fnm', 'node-versions'), path.join(home, '.local', 'share', 'fnm', 'node-versions')],
    versionCmd: 'node --version',
    skipDirs: COMMON_SKIP,
    binSubdir: null,
  },
  {
    id: 'mise-installs',
    name: 'mise-managed SDKs (all languages)',
    paths: [path.join(home, '.local', 'share', 'mise', 'installs')],
    versionCmd: null,
    skipDirs: COMMON_SKIP,
    binSubdir: null,
  },
  {
    id: 'sdkman-java',
    name: 'SDKMAN candidates (Java, Gradle, etc)',
    paths: [path.join(home, '.sdkman', 'candidates')],
    versionCmd: null,
    skipDirs: COMMON_SKIP,
    binSubdir: null,
  },
];

async function scanPortableSDKs({ deepSizeScan = false, progressCb = () => {} } = {}) {
  const found = [];
  for (const candidate of CANDIDATES) {
    const match = candidate.paths.find((p) => p && dirExists(p));
    if (!match) continue;

    let sizeLabel = 'size not measured';
    let bytes = null;
    if (deepSizeScan) {
      progressCb(`Measuring ${candidate.name}…`);
      const { bytes: b, truncated } = await estimateFolderSize(match, { skipDirs: candidate.skipDirs });
      bytes = b;
      sizeLabel = formatBytes(b) + (truncated ? '+ (estimate, very large)' : '');
    }

    let version = '';
    if (candidate.versionCmd) {
      const out = await execSafe(candidate.versionCmd);
      if (out) version = out.split('\n')[0].trim();
    }

    found.push({
      id: `portable:${candidate.id}`,
      name: candidate.name,
      category: 'Portable SDKs & caches',
      source: 'portable-folder',
      path: match,
      version,
      sizeLabel,
      bytes,
      skipDirs: candidate.skipDirs,
      binSubdir: candidate.binSubdir,
      type: 'portable-folder',
      // Binaries compiled for one OS won't run on another — this flag drives
      // the cross-OS warning in the UI and the fallback in the installers.
      portable: false,
      sourcePlatform: process.platform,
    });
  }
  return found;
}

module.exports = { scanPortableSDKs };
