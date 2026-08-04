(() => {
  let allItems = [];
  let scanPlatform = null;
  let activeCategory = 'All';
  let searchTerm = '';
  let sortKey = 'name';
  let sortDir = 'asc';
  const selected = new Set();

  const $ = (id) => document.getElementById(id);
  const el = {
    scanBtn: $('scanBtn'), deepSizeScan: $('deepSizeScan'), pinnedVersions: $('pinnedVersions'),
    targetOs: $('targetOs'), equivPolicy: $('equivPolicy'), searchInput: $('searchInput'),
    categoryList: $('categoryList'), itemList: $('itemList'), headCheck: $('headCheck'),
    compatBanner: $('compatBanner'), statusCounts: $('statusCounts'), statusSel: $('statusSel'),
    uninstallBtn: $('uninstallBtn'), packageLocalBtn: $('packageLocalBtn'), packageCloudBtn: $('packageCloudBtn'),
    scanLog: $('scanLog'), scanLogBody: $('scanLogBody'), logClose: $('logClose'),
    progressOverlay: $('progressOverlay'), progressTitle: $('progressTitle'),
    progressLog: $('progressLog'), progressCloseBtn: $('progressCloseBtn'),
  };

  const OS_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const describePlatform = (p) => OS_LABEL[p] || p || '';

  function appendLine(box, msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  const logScan = (m) => { el.scanLog.hidden = false; appendLine(el.scanLogBody, m); };
  const logProgress = (m) => appendLine(el.progressLog, m);

  window.clonebox.onScanProgress(logScan);
  window.clonebox.onPackageProgress(logProgress);
  window.clonebox.onUninstallProgress(logProgress);
  el.logClose.addEventListener('click', () => { el.scanLog.hidden = true; });

  const getTargetOs = () => (el.targetOs.value === 'same' ? scanPlatform : el.targetOs.value);

  // direct | equivalent | none | manual
  function getStatus(item) {
    if (item.type === 'manual-note') return 'manual';
    const target = getTargetOs();
    if (!target || target === scanPlatform) return 'direct';
    if (item.type === 'package' && item.portable === true) return 'direct';
    const eq = item.equivalents && item.equivalents[target];
    return eq && eq.cmd ? 'equivalent' : 'none';
  }

  const STATUS_TEXT = {
    direct: 'Direct',
    equivalent: 'Via equivalent',
    none: 'No equivalent',
    manual: 'Manual',
  };

  function fmtBytes(b) {
    if (b === null || b === undefined) return '';
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(1)} ${u[i]}`;
  }

  // ---------- Scan ----------
  el.scanBtn.addEventListener('click', async () => {
    el.scanBtn.disabled = true;
    el.scanBtn.textContent = 'Scanning…';
    el.statusCounts.textContent = 'Scanning…';
    el.scanLogBody.innerHTML = '';
    el.scanLog.hidden = false;
    selected.clear();

    const res = await window.clonebox.runScan({ deepSizeScan: el.deepSizeScan.checked });
    allItems = res.items || [];
    scanPlatform = res.platform;
    allItems.forEach((i) => { if (i.type !== 'manual-note') selected.add(i.id); });

    el.scanBtn.disabled = false;
    el.scanBtn.textContent = 'Rescan';
    el.statusCounts.textContent = res.error
      ? `Error: ${res.error}`
      : `${allItems.length} items · ${describePlatform(res.platform)} · ${res.hostname || ''}`;

    renderAll();
  });

  function renderAll() {
    renderCategories();
    renderGrid();
    renderBanner();
    renderStatus();
  }

  // ---------- Categories ----------
  function renderCategories() {
    const counts = new Map();
    allItems.forEach((i) => counts.set(i.category, (counts.get(i.category) || 0) + 1));
    el.categoryList.innerHTML = '';
    if (!allItems.length) {
      el.categoryList.innerHTML = '<li class="tree-empty">No scan yet</li>';
      return;
    }
    el.categoryList.appendChild(catRow('All', allItems.length));
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, n]) => el.categoryList.appendChild(catRow(name, n)));
  }

  function catRow(name, count) {
    const li = document.createElement('li');
    li.className = activeCategory === name ? 'active' : '';
    li.innerHTML = `<span class="tree-label"></span><span class="tree-count"></span>`;
    li.querySelector('.tree-label').textContent = name;
    li.querySelector('.tree-count').textContent = count;
    li.title = name;
    li.addEventListener('click', () => {
      activeCategory = name;
      renderCategories();
      renderGrid();
    });
    return li;
  }

  // ---------- Sorting ----------
  document.querySelectorAll('.grid-head .sortable').forEach((h) => {
    h.addEventListener('click', () => {
      const key = h.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = 'asc'; }
      document.querySelectorAll('.grid-head .sortable').forEach((x) => x.classList.remove('asc', 'desc'));
      h.classList.add(sortDir);
      renderGrid();
    });
  });

  function visibleItems() {
    const out = allItems.filter(
      (i) =>
        (activeCategory === 'All' || i.category === activeCategory) &&
        (!searchTerm || i.name.toLowerCase().includes(searchTerm))
    );

    const dir = sortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      let av, bv;
      if (sortKey === 'bytes') { av = a.bytes || 0; bv = b.bytes || 0; return (av - bv) * dir; }
      if (sortKey === 'status') { av = getStatus(a); bv = getStatus(b); }
      else { av = (a[sortKey] || '').toString().toLowerCase(); bv = (b[sortKey] || '').toString().toLowerCase(); }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return out;
  }

  el.searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    renderGrid();
  });

  // ---------- Grid ----------
  function renderGrid() {
    const items = visibleItems();
    el.itemList.innerHTML = '';

    if (!allItems.length) {
      el.itemList.innerHTML = '<div class="placeholder"><p>Click <b>Scan Device</b> to inventory installed packages, SDKs and tool folders.</p></div>';
      return;
    }
    if (!items.length) {
      el.itemList.innerHTML = '<div class="placeholder"><p>No items match the current filter.</p></div>';
      return;
    }

    // Rendering thousands of rows at once locks the UI; cap and note the rest.
    const CAP = 800;
    const shown = items.slice(0, CAP);
    const frag = document.createDocumentFragment();
    shown.forEach((item) => frag.appendChild(makeRow(item)));
    el.itemList.appendChild(frag);

    if (items.length > CAP) {
      const more = document.createElement('div');
      more.className = 'placeholder';
      more.textContent = `${items.length - CAP} more items hidden — narrow the filter or pick a category to see them.`;
      el.itemList.appendChild(more);
    }

    syncHeadCheck();
  }

  function makeRow(item) {
    const status = getStatus(item);
    const row = document.createElement('div');
    row.className = 'row' + (selected.has(item.id) ? ' checked' : '');

    const c1 = document.createElement('div');
    c1.className = 'cell cell-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(item.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(item.id); else selected.delete(item.id);
      row.classList.toggle('checked', cb.checked);
      renderStatus();
      renderBanner();
      syncHeadCheck();
    });
    c1.appendChild(cb);

    const c2 = document.createElement('div');
    c2.className = 'cell cell-name';
    c2.textContent = item.name;
    c2.title = item.path || item.originalPath || item.name;

    const c3 = document.createElement('div');
    c3.className = 'cell cell-ver';
    c3.textContent = item.version || '';

    const c4 = document.createElement('div');
    c4.className = 'cell cell-src';
    c4.textContent = item.source;

    const c5 = document.createElement('div');
    c5.className = 'cell cell-size';
    c5.textContent = item.bytes ? fmtBytes(item.bytes) : '';

    const c6 = document.createElement('div');
    c6.className = 'cell cell-status';
    const badge = document.createElement('span');
    badge.className = `st st-${status}`;
    badge.textContent = STATUS_TEXT[status];
    c6.appendChild(badge);

    const target = getTargetOs();
    const eq = item.equivalents && item.equivalents[target];
    if (status === 'equivalent') row.title = `On ${describePlatform(target)}: ${eq.cmd}`;
    else if (status === 'none' && eq && eq.note) row.title = eq.note;
    else if (status === 'none') row.title = `No verified ${describePlatform(target)} equivalent — will be skipped, not guessed`;
    else if (item.note) row.title = item.note;

    row.append(c1, c2, c3, c4, c5, c6);
    return row;
  }

  function syncHeadCheck() {
    const items = visibleItems();
    const checked = items.filter((i) => selected.has(i.id)).length;
    el.headCheck.checked = checked > 0 && checked === items.length;
    el.headCheck.indeterminate = checked > 0 && checked < items.length;
  }

  el.headCheck.addEventListener('change', () => {
    const items = visibleItems();
    if (el.headCheck.checked) items.forEach((i) => selected.add(i.id));
    else items.forEach((i) => selected.delete(i.id));
    renderGrid();
    renderStatus();
    renderBanner();
  });

  // ---------- Banner + status ----------
  el.targetOs.addEventListener('change', () => { renderGrid(); renderBanner(); });
  el.equivPolicy.addEventListener('change', renderBanner);

  function renderBanner() {
    const target = getTargetOs();
    if (!allItems.length || !target || target === scanPlatform) {
      el.compatBanner.hidden = true;
      return;
    }
    const sel = allItems.filter((i) => selected.has(i.id) && i.type !== 'manual-note');
    const direct = sel.filter((i) => getStatus(i) === 'direct').length;
    const equiv = sel.filter((i) => getStatus(i) === 'equivalent').length;
    const none = sel.filter((i) => getStatus(i) === 'none').length;

    const policyText = {
      ask: 'the installer will ask before each substitution',
      always: 'these will be substituted automatically',
      never: 'substitutions are disabled, so these will be skipped',
    }[el.equivPolicy.value];

    el.compatBanner.hidden = false;
    el.compatBanner.innerHTML =
      `<b>${describePlatform(scanPlatform)} → ${describePlatform(target)}:</b> ` +
      `<b>${direct}</b> install directly · <b>${equiv}</b> have a verified equivalent (${policyText}) · ` +
      `<b>${none}</b> have no known equivalent and will be skipped rather than guessed at.`;
  }

  function renderStatus() {
    const folders = allItems.filter((i) => selected.has(i.id) && i.type === 'portable-folder').length;
    el.statusSel.textContent =
      `${selected.size} selected` + (folders ? ` · ${folders} folder${folders === 1 ? '' : 's'} to zip` : '');
    const has = selected.size > 0;
    el.packageLocalBtn.disabled = !has;
    el.packageCloudBtn.disabled = !has;
    el.uninstallBtn.disabled = !has;
  }

  // ---------- Packaging ----------
  async function runPackaging(title) {
    const folder = await window.clonebox.chooseFolder(title);
    if (!folder) return;

    el.progressOverlay.hidden = false;
    el.progressTitle.textContent = 'Building package…';
    el.progressLog.innerHTML = '';
    el.progressCloseBtn.hidden = true;

    const items = allItems.filter((i) => selected.has(i.id));
    const res = await window.clonebox.buildPackage(items, folder, {
      usePinnedVersions: el.pinnedVersions.checked,
      equivalentPolicy: el.equivPolicy.value,
    });

    el.progressCloseBtn.hidden = false;
    if (!res.ok) {
      el.progressTitle.textContent = 'Packaging failed';
      logProgress(res.error);
      el.progressCloseBtn.textContent = 'Close';
      el.progressCloseBtn.onclick = () => { el.progressOverlay.hidden = true; };
      return;
    }

    el.progressTitle.textContent = `Package ready — ${res.itemCount} items`;
    logProgress('Wrote manifest.json, install.ps1, install.sh, COMPATIBILITY.md');
    el.progressCloseBtn.textContent = 'Open Folder';
    el.progressCloseBtn.onclick = () => {
      window.clonebox.openFolder(res.outDir);
      el.progressOverlay.hidden = true;
    };
  }

  el.packageLocalBtn.addEventListener('click', () =>
    runPackaging('Choose destination folder (external drive, network share)')
  );
  el.packageCloudBtn.addEventListener('click', () =>
    runPackaging('Choose a folder to prepare, then sync it to Drive / OneDrive / Dropbox')
  );

  // ---------- Uninstall ----------
  el.uninstallBtn.addEventListener('click', async () => {
    const removable = allItems.filter(
      (i) => selected.has(i.id) && (i.type === 'package' || i.type === 'portable-folder')
    );
    if (!removable.length) {
      window.alert('Nothing removable is selected.');
      return;
    }
    const preview = removable.slice(0, 12).map((i) => `  ${i.name}`).join('\n');
    const more = removable.length > 12 ? `\n  …and ${removable.length - 12} more` : '';
    if (!window.confirm(`Permanently uninstall ${removable.length} item(s) from THIS device?\n\n${preview}${more}\n\nThis cannot be undone.`)) return;

    el.progressOverlay.hidden = false;
    el.progressTitle.textContent = 'Uninstalling…';
    el.progressLog.innerHTML = '';
    el.progressCloseBtn.hidden = true;

    const { results } = await window.clonebox.uninstallItems(removable);
    const ok = results.filter((r) => r.ok).length;
    el.progressTitle.textContent = `Done — ${ok}/${results.length} removed`;
    el.progressCloseBtn.hidden = false;
    el.progressCloseBtn.textContent = 'Close and Rescan';
    el.progressCloseBtn.onclick = () => {
      el.progressOverlay.hidden = true;
      el.scanBtn.click();
    };
  });
})();
