const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { exec } = require('child_process'); 
const { promisify } = require('util');
const fsp = require('fs/promises');
const path = require('path');
const { runFullScan } = require('./scanners'); 
const { packageSelection } = require('./packager/build');
const { getUninstallCommand } = require('./scanners/uninstall');
 
const execAsync = promisify(exec);
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#131313',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Scan (async throughout, so the window stays responsive) ---
ipcMain.handle('scan:run', async (event, { deepSizeScan }) => {
  const sender = event.sender;
  try {
    return await runFullScan({
      deepSizeScan,
      progressCb: (msg) => sender.send('scan:progress', msg),
    });
  } catch (err) {
    sender.send('scan:progress', `Scan failed: ${err.message}`);
    return { platform: process.platform, items: [], error: err.message };
  }
});

ipcMain.handle('dialog:chooseFolder', async (_event, { title }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose destination folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('package:build', async (event, { items, outDir, usePinnedVersions, equivalentPolicy }) => {
  const sender = event.sender;
  try {
    const summary = await packageSelection(items, outDir, {
      usePinnedVersions,
      equivalentPolicy: equivalentPolicy || 'ask',
      progressCb: (msg) => sender.send('package:progress', msg),
    });
    return { ok: true, ...summary };
  } catch (err) {
    sender.send('package:progress', `Failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('shell:openFolder', async (_event, folderPath) => {
  shell.openPath(folderPath);
});

// --- Uninstall from THIS device ---
// Elevated commands are never run directly: a GUI app has no reliable way to
// answer a sudo/UAC prompt, so those are written to a script for the user to
// review and run themselves.
ipcMain.handle('device:uninstall', async (event, { items }) => {
  const sender = event.sender;
  const results = [];
  const deferred = [];

  for (const item of items) {
    if (item.type === 'portable-folder' && (item.path || item.originalPath)) {
      const target = item.path || item.originalPath;
      try {
        await fsp.rm(target, { recursive: true, force: true });
        sender.send('uninstall:progress', `Deleted folder: ${item.name}`);
        results.push({ id: item.id, ok: true });
      } catch (err) {
        sender.send('uninstall:progress', `Failed to delete ${item.name}: ${err.message}`);
        results.push({ id: item.id, ok: false, note: err.message });
      }
      continue;
    }

    const uninstall = getUninstallCommand(item);
    if (!uninstall) {
      sender.send('uninstall:progress', `No automatic uninstall for ${item.name} — skipped`);
      results.push({ id: item.id, ok: false, note: 'no uninstall command for this source' });
      continue;
    }

    if (uninstall.needsElevation) {
      deferred.push(process.platform === 'win32' ? uninstall.cmd : `sudo ${uninstall.cmd}`);
      sender.send('uninstall:progress', `Deferred (needs admin/sudo): ${item.name}`);
      results.push({ id: item.id, ok: false, note: 'deferred — needs elevation' });
      continue;
    }

    sender.send('uninstall:progress', `Running: ${uninstall.cmd}`);
    try {
      await execAsync(uninstall.cmd, { timeout: 120000, windowsHide: true });
      sender.send('uninstall:progress', `Removed ${item.name}`);
      results.push({ id: item.id, ok: true });
    } catch (err) {
      sender.send('uninstall:progress', `Failed: ${item.name}`);
      results.push({ id: item.id, ok: false, note: err.message });
    }
  }

  let deferredPath = null;
  if (deferred.length) {
    const ext = process.platform === 'win32' ? 'ps1' : 'sh';
    deferredPath = path.join(app.getPath('desktop'), `clonebox-elevated-uninstall.${ext}`);
    await fsp.writeFile(deferredPath, deferred.join('\n'));
    sender.send(
      'uninstall:progress',
      `${deferred.length} item(s) need elevation — review and run: ${deferredPath}`
    );
  }

  return { results, deferredPath };
});
