const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const execAsync = promisify(exec);

// Async so the Electron main process event loop stays free — the previous
// execSync version froze the whole window for the duration of a scan.
// Returns trimmed stdout, or null if the tool isn't installed / it failed.
async function execSafe(cmd, opts = {}) {
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 16, // some package lists are genuinely large
      windowsHide: true,
      ...opts,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

// True if the command exists on PATH. Cheaper and more reliable than
// running the tool itself just to see if it errors.
async function hasCommand(name) {
  const probe = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`;
  const result = await execSafe(probe);
  return !!result;
}

function dirExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Walks a folder to estimate size. Async and capped so a 30GB Android SDK
// doesn't stall the scan. skipDirs avoids counting things we exclude from
// the zip anyway (e.g. .git inside the Flutter SDK).
async function estimateFolderSize(dirPath, { maxFiles = 40000, skipDirs = [] } = {}) {
  let total = 0;
  let count = 0;
  let truncated = false;
  const stack = [dirPath];

  while (stack.length) {
    if (count >= maxFiles) { truncated = true; break; }
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= maxFiles) { truncated = true; break; }
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(path.join(current, entry.name));
          total += stat.size;
        } catch {
          /* unreadable file, skip */
        }
        count += 1;
      }
    }
  }
  return { bytes: total, truncated };
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

// Free space on the volume holding targetPath, so we can refuse to start a
// 40GB zip onto a 12GB drive instead of failing halfway through.
async function getFreeSpace(targetPath) {
  try {
    const stats = await fsp.statfs(targetPath);
    return stats.bavail * stats.bsize;
  } catch {
    return null; // statfs needs Node 18.15+; treat as unknown rather than erroring
  }
}

module.exports = {
  execSafe,
  hasCommand,
  dirExists,
  estimateFolderSize,
  formatBytes,
  getFreeSpace,
};
