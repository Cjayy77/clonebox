const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execSafe } = require('../scanners/utils');

// The entire premise of provenance pruning is "nothing has touched this in
// months". That claim is only meaningful if the filesystem actually records
// reads. It frequently doesn't:
//
//   - Linux `noatime`      : never records reads. Unusable.
//   - Linux `relatime`     : records at ~24h granularity. Fine for our needs.
//   - Windows NTFS         : last-access updates are OFF by default since
//                            Vista (NtfsDisableLastAccessUpdate). Usually unusable.
//   - macOS APFS           : records reads, though SSD-friendly deferral applies.
//
// Rather than trusting mount flags or registry keys alone, this writes a probe
// file, backdates its atime, reads it, and checks whether the kernel moved the
// timestamp. Empirical beats documented.

const VERDICT = {
  RELIABLE: 'reliable',
  COARSE: 'coarse',
  DISABLED: 'disabled',
  UNKNOWN: 'unknown',
};

async function probeAtime(testDir = os.tmpdir()) {
  const probePath = path.join(testDir, `.clonebox-atime-probe-${process.pid}`);

  try {
    await fsp.writeFile(probePath, 'probe');

    // Backdate atime well past any relatime threshold.
    const old = new Date('2020-01-01T00:00:00Z');
    const statBefore = await fsp.stat(probePath);
    await fsp.utimes(probePath, old, statBefore.mtime);

    const recorded = (await fsp.stat(probePath)).atime;
    if (Math.abs(recorded.getTime() - old.getTime()) > 60000) {
      // Couldn't even set it — filesystem is ignoring atime entirely.
      await cleanup(probePath);
      return {
        verdict: VERDICT.DISABLED,
        detail: 'Filesystem ignored an explicit atime write.',
      };
    }

    // Read the file and see whether the kernel advances atime.
    await fsp.readFile(probePath);
    const after = (await fsp.stat(probePath)).atime;
    const moved = after.getTime() - old.getTime();

    await cleanup(probePath);

    if (moved > 60000) {
      const mountInfo = await describeMount();
      return {
        verdict: mountInfo.includes('relatime') ? VERDICT.COARSE : VERDICT.RELIABLE,
        detail: mountInfo.includes('relatime')
          ? 'relatime: reads are recorded at roughly 24h granularity. Good enough for "unused for months" questions, useless for "used today".'
          : `Access times update on read (${mountInfo || 'mount options unknown'}).`,
      };
    }

    return {
      verdict: VERDICT.DISABLED,
      detail:
        process.platform === 'win32'
          ? 'NTFS last-access updates appear disabled (the Windows default since Vista). Age-based signals are unavailable; provenance falls back to project references only.'
          : `Reads do not update access time (${await describeMount()}). Likely noatime.`,
    };
  } catch (err) {
    await cleanup(probePath);
    return { verdict: VERDICT.UNKNOWN, detail: `Probe failed: ${err.message}` };
  }
}

async function cleanup(p) {
  try {
    await fsp.unlink(p);
  } catch {
    /* already gone */
  }
}

async function describeMount() {
  if (process.platform === 'win32') return 'NTFS';
  const out = await execSafe('findmnt -no OPTIONS /');
  if (out) return out;
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    const rootLine = mounts.split('\n').find((l) => l.split(' ')[1] === '/');
    return rootLine ? rootLine.split(' ')[3] : '';
  } catch {
    return '';
  }
}

// Windows records the setting in the registry even when the probe is
// ambiguous; worth surfacing because it's user-fixable.
async function windowsAtimeHint() {
  if (process.platform !== 'win32') return null;
  const out = await execSafe(
    'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisableLastAccessUpdate'
  );
  if (!out) return null;
  const disabled = /0x[13]/.test(out);
  return disabled
    ? 'NtfsDisableLastAccessUpdate is on. To enable age tracking: fsutil behavior set disablelastaccess 0 (admin, needs reboot, small write cost).'
    : 'NtfsDisableLastAccessUpdate appears off; access times should be recorded.';
}

module.exports = { probeAtime, windowsAtimeHint, VERDICT };
