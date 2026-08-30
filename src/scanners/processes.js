const fs = require('fs/promises');
const { execSafe } = require('./utils');

// Live-activity scanner: unlike the rest of src/scanners, this doesn't
// inventory *installed* things — it looks at what's *currently running* on
// the machine (dev servers, databases, language runtimes) and which TCP
// ports they're bound to. Meant for the "what's already using port 5432 /
// is there already a vite dev server up" question, not for packaging.

// Ordered list of (kind, label, matcher). First match wins, so put more
// specific patterns (a framework's dev server) before generic ones
// (a bare "node" process running a compiled server).
const DEV_PROCESS_PATTERNS = [
  { kind: 'vite', label: 'Vite dev server', test: /\bvite\b/i },
  { kind: 'webpack', label: 'Webpack dev server', test: /webpack(-dev-server)?\b/i },
  { kind: 'next', label: 'Next.js', test: /\bnext(\.js)?\s+(dev|start)\b|\/next dev/i },
  { kind: 'nuxt', label: 'Nuxt', test: /\bnuxt\b/i },
  { kind: 'parcel', label: 'Parcel', test: /\bparcel\b/i },
  { kind: 'angular', label: 'Angular CLI', test: /\bng\s+serve\b/i },
  { kind: 'create-react-app', label: 'Create React App', test: /react-scripts\s+start/i },
  { kind: 'nodemon', label: 'Nodemon', test: /\bnodemon\b/i },
  { kind: 'npm', label: 'npm', test: /\bnpm\b/i },
  { kind: 'yarn', label: 'Yarn', test: /\byarn\b/i },
  { kind: 'pnpm', label: 'pnpm', test: /\bpnpm\b/i },
  { kind: 'bun', label: 'Bun', test: /\bbun\b/i },
  { kind: 'deno', label: 'Deno', test: /\bdeno\b/i },
  { kind: 'node', label: 'Node.js', test: /\bnode\b/i },
  { kind: 'django', label: 'Django (manage.py)', test: /manage\.py\s+runserver/i },
  { kind: 'flask', label: 'Flask', test: /\bflask\s+run\b|\bFLASK_APP\b/i },
  { kind: 'uvicorn', label: 'Uvicorn (ASGI)', test: /\buvicorn\b/i },
  { kind: 'gunicorn', label: 'Gunicorn (WSGI)', test: /\bgunicorn\b/i },
  { kind: 'streamlit', label: 'Streamlit', test: /\bstreamlit\s+run\b/i },
  { kind: 'jupyter', label: 'Jupyter', test: /\bjupyter[-\s](notebook|lab)\b/i },
  { kind: 'pip', label: 'pip', test: /\bpip3?\b/i },
  { kind: 'python', label: 'Python', test: /\bpython3?(\.\d+)?\b/i },
  { kind: 'rails', label: 'Rails server', test: /rails\s+(server|s\b)|puma\b/i },
  { kind: 'ruby', label: 'Ruby', test: /\bruby\b/i },
  { kind: 'php-artisan', label: 'Laravel (artisan serve)', test: /artisan\s+serve/i },
  { kind: 'php', label: 'PHP built-in server', test: /\bphp\b.*-S\s|\bphp-fpm\b/i },
  { kind: 'dotnet', label: '.NET', test: /\bdotnet\b/i },
  { kind: 'go-run', label: 'Go (go run)', test: /\bgo\s+run\b|\bair\b/i },
  { kind: 'cargo', label: 'Rust (cargo)', test: /\bcargo\s+(run|watch)\b/i },
  { kind: 'postgres', label: 'PostgreSQL', test: /\bpostgres(ql)?\b|\bpostmaster\b/i },
  { kind: 'mysql', label: 'MySQL / MariaDB', test: /\bmysqld\b|\bmariadbd\b/i },
  { kind: 'mongodb', label: 'MongoDB', test: /\bmongod\b/i },
  { kind: 'redis', label: 'Redis', test: /\bredis-server\b/i },
  { kind: 'memcached', label: 'Memcached', test: /\bmemcached\b/i },
  { kind: 'elasticsearch', label: 'Elasticsearch', test: /\belasticsearch\b/i },
  { kind: 'docker', label: 'Docker', test: /\bdockerd\b|\bcom\.docker\b|\bdocker-compose\b/i },
  { kind: 'nginx', label: 'nginx', test: /\bnginx\b/i },
  { kind: 'caddy', label: 'Caddy', test: /\bcaddy\b/i },
  { kind: 'apache', label: 'Apache httpd', test: /\bhttpd\b|\bapache2\b/i },
  { kind: 'ollama', label: 'Ollama', test: /\bollama\b/i },
];

function classify(command) {
  if (!command) return null;
  for (const pattern of DEV_PROCESS_PATTERNS) {
    if (pattern.test.test(command)) return pattern;
  }
  return null;
}

// --- Process listing (pid, ppid, name, full command line) ---

async function listProcessesUnix() {
  // GNU ps (Linux) and BSD ps (macOS) both understand this column set,
  // even though their flag conventions otherwise differ.
  const out = await execSafe('ps -eo pid,ppid,comm,args');
  if (!out) return [];
  const lines = out.split('\n').slice(1); // header row
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, ppid, comm, args] = match;
    rows.push({ pid: Number(pid), ppid: Number(ppid), name: comm, command: args || comm });
  }
  return rows;
}

async function listProcessesWindows() {
  // CIM/WMI gives a real command line (needed to tell "node server.js" from
  // "node build.js"), which tasklist alone does not provide.
  const psCmd =
    'powershell -NoProfile -NonInteractive -Command ' +
    '"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"';
  const out = await execSafe(psCmd, { timeout: 20000 });
  if (out) {
    try {
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter((p) => p && p.ProcessId)
        .map((p) => ({
          pid: p.ProcessId,
          ppid: p.ParentProcessId || 0,
          name: p.Name || '',
          command: p.CommandLine || p.Name || '',
        }));
    } catch {
      /* fall through to tasklist */
    }
  }

  // Fallback for locked-down machines where PowerShell CIM is blocked —
  // no command line, but at least names and PIDs.
  const tlOut = await execSafe('tasklist /fo csv /nh');
  if (!tlOut) return [];
  return tlOut
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
      return { pid: Number(cols[1]) || 0, ppid: 0, name: cols[0] || '', command: cols[0] || '' };
    })
    .filter((p) => p.pid);
}

async function listProcesses() {
  return process.platform === 'win32' ? listProcessesWindows() : listProcessesUnix();
}

// --- Listening TCP ports, mapped to owning PID where the OS will tell us ---

async function listListeningPortsUnix() {
  // lsof is available on both Linux and macOS by default and gives PID
  // directly. ss is Linux-only but doesn't need lsof to be installed, so
  // it's tried second. Neither is guaranteed present (minimal server images,
  // containers) so /proc/net/tcp is the last-resort fallback on Linux.
  const lsofOut = await execSafe('lsof -iTCP -sTCP:LISTEN -n -P');
  if (lsofOut) {
    const rows = [];
    for (const line of lsofOut.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 9) continue;
      const [, pidStr, , , , , , , name] = cols;
      const portMatch = name && name.match(/:(\d+)$/);
      if (!portMatch) continue;
      rows.push({ port: Number(portMatch[1]), proto: 'tcp', pid: Number(pidStr) || null, address: name });
    }
    if (rows.length) return dedupePorts(rows);
  }

  const ssOut = await execSafe('ss -ltnp');
  if (ssOut) {
    const rows = [];
    for (const line of ssOut.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const localAddr = cols[3];
      const portMatch = localAddr && localAddr.match(/:(\d+)$/);
      if (!portMatch) continue;
      const pidMatch = line.match(/pid=(\d+)/);
      rows.push({
        port: Number(portMatch[1]),
        proto: 'tcp',
        pid: pidMatch ? Number(pidMatch[1]) : null, // often unavailable without root
        address: localAddr,
      });
    }
    if (rows.length) return dedupePorts(rows);
  }

  if (process.platform === 'linux') {
    const procRows = await listListeningPortsProcFs();
    if (procRows.length) return dedupePorts(procRows);
  }

  return [];
}

// Reads /proc/net/tcp{,6} directly — always present on Linux, no external
// binary required. PID attribution walks /proc/<pid>/fd looking for a
// socket inode match, which only succeeds for processes this user owns
// (or all of them, if Clonebox itself is run as root) — that's a real
// limitation, not a bug, so callers should treat a missing pid as "unknown
// owner" rather than "nothing is listening here".
async function listListeningPortsProcFs() {
  const rows = [];
  const files = ['/proc/net/tcp', '/proc/net/tcp6'];
  const inodeToPort = new Map();

  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n').slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      // sl local_address rem_address st tx:rx tr:tm retrnsmt uid timeout inode
      if (cols.length < 10) continue;
      const [, localAddr, , st, , , , , , inode] = cols;
      if (st !== '0A') continue; // TCP_LISTEN
      const portHex = localAddr.split(':')[1];
      if (!portHex) continue;
      const port = parseInt(portHex, 16);
      inodeToPort.set(inode, port);
    }
  }
  if (!inodeToPort.size) return rows;

  const matchedInodes = new Set();
  let pidDirs;
  try {
    pidDirs = (await fs.readdir('/proc')).filter((d) => /^\d+$/.test(d));
  } catch {
    return rows;
  }

  for (const pidStr of pidDirs) {
    let fds;
    try {
      fds = await fs.readdir(`/proc/${pidStr}/fd`);
    } catch {
      continue; // not our process, or it exited mid-scan
    }
    for (const fd of fds) {
      let link;
      try {
        link = await fs.readlink(`/proc/${pidStr}/fd/${fd}`);
      } catch {
        continue;
      }
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (!m) continue;
      const inode = m[1];
      if (!inodeToPort.has(inode)) continue;
      rows.push({ port: inodeToPort.get(inode), proto: 'tcp', pid: Number(pidStr), address: `:${inodeToPort.get(inode)}` });
      matchedInodes.add(inode);
    }
  }

  // Any listening socket whose owning process we couldn't map (usually
  // because it belongs to another user) still gets reported, just without a pid.
  for (const [inode, port] of inodeToPort) {
    if (!matchedInodes.has(inode)) {
      rows.push({ port, proto: 'tcp', pid: null, address: `:${port}` });
    }
  }

  return rows;
}

async function listListeningPortsWindows() {
  const out = await execSafe('netstat -ano -p tcp');
  if (!out) return [];
  const rows = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TCP')) continue;
    const cols = trimmed.split(/\s+/);
    // Proto  LocalAddress  ForeignAddress  State  PID
    if (cols.length < 5 || cols[3] !== 'LISTENING') continue;
    const portMatch = cols[1].match(/:(\d+)$/);
    if (!portMatch) continue;
    rows.push({ port: Number(portMatch[1]), proto: 'tcp', pid: Number(cols[4]) || null, address: cols[1] });
  }
  return dedupePorts(rows);
}

function dedupePorts(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.port}:${r.pid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function listListeningPorts() {
  return process.platform === 'win32' ? listListeningPortsWindows() : listListeningPortsUnix();
}

// --- Combine process list + port list + classification into one report ---

async function scanActivity() {
  const [processes, ports] = await Promise.all([listProcesses(), listListeningPorts()]);

  const portsByPid = new Map();
  for (const p of ports) {
    if (!p.pid) continue;
    if (!portsByPid.has(p.pid)) portsByPid.set(p.pid, []);
    portsByPid.get(p.pid).push({ port: p.port, proto: p.proto });
  }

  const devProcesses = [];
  for (const proc of processes) {
    const match = classify(proc.command || proc.name);
    const procPorts = portsByPid.get(proc.pid) || [];
    // Keep it either if it matched a known dev tool, or if it's an unknown
    // process that's holding a port open — both answer "what's running and
    // where", which is the point of this scanner.
    if (!match && procPorts.length === 0) continue;
    devProcesses.push({
      pid: proc.pid,
      ppid: proc.ppid,
      name: proc.name,
      command: proc.command,
      kind: match ? match.kind : 'unknown',
      label: match ? match.label : proc.name,
      ports: procPorts.sort((a, b) => a.port - b.port),
    });
  }

  // Ports with no resolvable PID (common on Linux without root, or a race
  // where the process exited between the two commands) — still worth
  // showing since "what's using port X" was the ask even if the owner isn't known.
  const unattributedPorts = ports
    .filter((p) => !p.pid || !processes.some((proc) => proc.pid === p.pid))
    .map((p) => ({ port: p.port, proto: p.proto, address: p.address }));

  devProcesses.sort((a, b) => {
    if (a.ports.length !== b.ports.length) return b.ports.length - a.ports.length;
    return a.label.localeCompare(b.label);
  });

  return {
    scannedAt: new Date().toISOString(),
    platform: process.platform,
    processes: devProcesses,
    unattributedPorts: dedupePorts(unattributedPorts.map((p) => ({ ...p, pid: null }))).map((p) => ({
      port: p.port,
      proto: p.proto,
      address: p.address,
    })),
  };
}

module.exports = { scanActivity, classify, DEV_PROCESS_PATTERNS };
