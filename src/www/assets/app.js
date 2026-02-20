/* =============================================
   Reverse Proxy UI — SPA Application
   ============================================= */

const API_BASE = '/api.php?_path=';

// ============ API Client ============
const api = {
    async request(method, path, body = null) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(`${API_BASE}${path}`, opts);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    },
    login(pw) { return this.request('POST', 'login', { password: pw }); },
    checkAuth() { return this.request('GET', 'auth/check'); },
    logout() { return this.request('POST', 'logout'); },
    getDomains(s) { return this.request('GET', s ? `domains&status=${s}` : 'domains'); },
    addDomains(names, ip) { return this.request('POST', 'domains', { names, ip }); },
    deleteDomains(ids) { return this.request('POST', 'domains/delete', { ids }); },
    updateDomain(id, data) { return this.request('POST', 'domains/update', { id, ...data }); },
    restartNginx() { return this.request('POST', 'domains/restart'); },
    getStatus() { return this.request('GET', 'status'); },
};

// ============ State ============
const state = {
    domains: [],
    selectedIds: new Set(),
    filter: '',
    search: '',
    isGenerating: false,
    sortField: 'id',
    sortDir: 'desc',
    loading: true,
    refreshInterval: null,
};

// ============ Toasts ============
function showToast(message, type = 'info') {
    const c = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <span class="toast-message">${esc(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
    c.appendChild(t);
    setTimeout(() => {
        t.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}

// ============ Views ============
function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

// ============ Login ============
async function handleLogin(e) {
    e.preventDefault();
    const inp = document.getElementById('login-password');
    const err = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';
    err.style.display = 'none';
    try {
        await api.login(inp.value);
        showView('dashboard-view');
        loadDomains();
        checkNginxStatus();
        startAutoRefresh();
    } catch (e) {
        err.textContent = e.message || 'Wrong password';
        err.style.display = 'block';
        inp.value = '';
        inp.focus();
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Login';
    }
}

async function handleLogout() {
    stopAutoRefresh();
    try { await api.logout(); } catch { }
    showView('login-view');
}

// ============ Init ============
async function init() {
    try {
        const a = await api.checkAuth();
        if (a.authenticated) {
            showView('dashboard-view');
            loadDomains();
            checkNginxStatus();
            startAutoRefresh();
        } else {
            showView('login-view');
        }
    } catch { showView('login-view'); }

    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('search-input').addEventListener('input', e => {
        state.search = e.target.value;
        renderDomains();
    });
    document.getElementById('select-all').addEventListener('change', handleSelectAll);

    // Theme
    const saved = localStorage.getItem('theme') || 'dark';
    applyTheme(saved);

    // Drag & drop
    setupDragDrop();
}

// ============ Auto-refresh (30s) ============
function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshInterval = setInterval(() => {
        if (!state.isGenerating) loadDomains();
    }, 30000);
}
function stopAutoRefresh() {
    if (state.refreshInterval) clearInterval(state.refreshInterval);
    state.refreshInterval = null;
}

// ============ Load & Render Domains ============
async function loadDomains() {
    const skel = document.getElementById('skeleton');
    if (state.loading) skel.style.display = 'block';
    try {
        state.domains = await api.getDomains();
        state.loading = false;
        skel.style.display = 'none';
        renderDomains();
        updateStats();
        updateIpGroups();
        updateFavicon();
    } catch (e) {
        state.loading = false;
        skel.style.display = 'none';
        showToast('Failed to load: ' + e.message, 'error');
    }
}

function renderDomains() {
    const tbody = document.getElementById('domain-tbody');
    const empty = document.getElementById('empty-state');
    const countEl = document.getElementById('domain-count');
    const summaryEl = document.getElementById('summary-row');

    let list = state.domains;
    if (state.filter) list = list.filter(d => d.status === state.filter);
    if (state.search) {
        const q = state.search.toLowerCase();
        list = list.filter(d =>
            d.name.toLowerCase().includes(q) ||
            (d.ip || '').includes(q) ||
            (d.dns_ip || '').includes(q)
        );
    }

    // Sort
    list = sortList(list);

    countEl.innerHTML = `Showing <strong>${list.length}</strong> of <strong>${state.domains.length}</strong> domains`;

    // Summary row
    if (list.length > 0) {
        const activeCount = list.filter(d => d.status === 'active').length;
        const sslWarn = list.filter(d => d.ssl_days_left !== null && d.ssl_days_left < 14).length;
        summaryEl.innerHTML = `
            <tr class="summary-row">
                <td></td>
                <td><strong>Total</strong></td>
                <td><strong>${list.length} domain(s)</strong></td>
                <td></td>
                <td></td>
                <td><span class="val-green">${activeCount} active</span></td>
                <td>${sslWarn ? `<span class="val-accent">${sslWarn} expiring</span>` : ''}</td>
                <td></td>
                <td></td>
            </tr>`;
    } else {
        summaryEl.innerHTML = '';
    }

    if (list.length === 0) {
        empty.style.display = 'block';
        tbody.innerHTML = '';
        return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = list.map((d, i) => `
        <tr class="${state.selectedIds.has(d.id) ? 'selected' : ''}" data-id="${d.id}" style="animation-delay:${Math.min(i * 30, 300)}ms">
            <td data-label=""><input type="checkbox" class="cb" data-id="${d.id}"
                ${state.selectedIds.has(d.id) ? 'checked' : ''}
                onchange="toggleSelect(${d.id}, this.checked)"></td>
            <td class="col-id" data-label="ID">#${d.id}</td>
            <td data-label="Domain">
                <div class="domain-name">
                    <a href="https://${esc(d.name)}" target="_blank">${esc(d.name)}</a>
                    <span class="domain-ip-hint">${esc(d.ip || '')} → ${esc(d.dns_ip || '?')}</span>
                </div>
            </td>
            <td class="cell-mono cell-editable" data-label="Dest IP" ondblclick="inlineEdit(this, ${d.id}, 'ip', '${esc(d.ip || '')}')" title="Double-click to edit">${esc(d.ip || '—')}</td>
            <td class="cell-mono ${d.dns_ip === d.ip ? 'val-green' : ''}" data-label="DNS IP">${esc(d.dns_ip || '—')}</td>
            <td data-label="Status"><span class="badge badge-${d.status}">${d.status}</span></td>
            <td data-label="SSL">${renderSSL(d)}</td>
            <td style="font-size:12px; color:var(--text-muted)" data-label="Date">${esc(d.date || '—')}</td>
            <td data-label=""><button class="btn btn-ghost btn-sm" onclick="deleteSingle(${d.id})" title="Delete">✕</button></td>
        </tr>`).join('');

    document.getElementById('select-all').checked =
        list.length > 0 && list.every(d => state.selectedIds.has(d.id));
}

// ============ SSL Badge ============
function renderSSL(d) {
    if (d.ssl_days_left === null || d.ssl_days_left === undefined) {
        return '<span class="ssl-badge ssl-none">—</span>';
    }
    const days = d.ssl_days_left;
    let cls = 'ssl-ok', icon = '🔒';
    if (days < 7) { cls = 'ssl-danger'; icon = '⚠️'; }
    else if (days < 14) { cls = 'ssl-warn'; icon = '⏳'; }
    return `<span class="ssl-badge ${cls}">${icon} ${days}d</span>`;
}

// ============ Sorting ============
function toggleSort(field) {
    if (state.sortField === field) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortField = field;
        state.sortDir = 'asc';
    }
    // Update arrows
    document.querySelectorAll('.sort-arrow').forEach(el => {
        el.className = 'sort-arrow';
        if (el.dataset.col === field) el.classList.add(state.sortDir);
    });
    renderDomains();
}

function sortList(list) {
    const f = state.sortField;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
        let va = a[f] ?? '', vb = b[f] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        if (f === 'id') return (Number(va) - Number(vb)) * dir;
        if (f === 'ssl_days_left') {
            va = va === null ? 9999 : va;
            vb = vb === null ? 9999 : vb;
            return (va - vb) * dir;
        }
        return String(va).localeCompare(String(vb)) * dir;
    });
}

// ============ Stats ============
function updateStats() {
    const counts = { total: 0, active: 0, pending: 0, failed: 0, sslWarn: 0, other: 0 };
    state.domains.forEach(d => {
        counts.total++;
        if (d.status === 'active') counts.active++;
        else if (d.status === 'pending') counts.pending++;
        else if (d.status === 'failed' || d.status === 'dns_error') counts.failed++;
        else counts.other++;
        if (d.ssl_days_left !== null && d.ssl_days_left < 14) counts.sslWarn++;
    });
    document.getElementById('stat-total').textContent = counts.total;
    document.getElementById('stat-active').textContent = counts.active;
    document.getElementById('stat-pending').textContent = counts.pending;
    document.getElementById('stat-failed').textContent = counts.failed;
    document.getElementById('stat-ssl-warn').textContent = counts.sslWarn;

    // Health bar
    const bar = document.getElementById('health-bar');
    if (counts.total === 0) { bar.innerHTML = ''; return; }
    const pct = n => Math.round((n / counts.total) * 100);
    const activeP = pct(counts.active);
    const pendingP = pct(counts.pending);
    const failedP = pct(counts.failed);
    const otherP = 100 - activeP - pendingP - failedP;
    bar.innerHTML = `
        <div class="health-bar-label">
            <span>Health</span>
            <span>${activeP}% active</span>
        </div>
        <div class="health-bar-track">
            <div class="health-bar-fill green" style="width:${activeP}%"></div>
            <div class="health-bar-fill accent" style="width:${pendingP}%"></div>
            <div class="health-bar-fill red" style="width:${failedP}%"></div>
            <div class="health-bar-fill muted" style="width:${otherP}%"></div>
        </div>`;
}

// ============ IP Groups ============
function updateIpGroups() {
    const groups = {};
    state.domains.forEach(d => {
        const ip = d.ip || 'unknown';
        groups[ip] = (groups[ip] || 0) + 1;
    });
    const el = document.getElementById('ip-groups');
    if (Object.keys(groups).length <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([ip, count]) => `<span class="ip-group"><strong>${count}</strong> → ${esc(ip)}</span>`)
        .join('');
}

// ============ Filters ============
function setFilter(s) {
    state.filter = s;
    document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
    document.querySelector(`.filter-tag[data-status="${s}"]`).classList.add('active');
    state.selectedIds.clear();
    updateBulkBar();
    renderDomains();
}

// ============ Selection ============
function toggleSelect(id, checked) {
    checked ? state.selectedIds.add(id) : state.selectedIds.delete(id);
    updateBulkBar();
    renderDomains();
}

function handleSelectAll(e) {
    const vis = getVisible();
    vis.forEach(d => e.target.checked ? state.selectedIds.add(d.id) : state.selectedIds.delete(d.id));
    updateBulkBar();
    renderDomains();
}

function getVisible() {
    let f = state.domains;
    if (state.filter) f = f.filter(d => d.status === state.filter);
    if (state.search) {
        const q = state.search.toLowerCase();
        f = f.filter(d => d.name.toLowerCase().includes(q));
    }
    return f;
}

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const n = state.selectedIds.size;
    if (n > 0) {
        bar.classList.add('visible');
        document.getElementById('selected-count').textContent = `${n} selected`;
    } else {
        bar.classList.remove('visible');
    }
}

// ============ CRUD ============
async function addDomains() {
    const ta = document.getElementById('domains-input');
    const ipIn = document.getElementById('ip-input');
    const btn = document.getElementById('add-btn');
    const raw = ta.value.trim();
    const ip = ipIn.value.trim();
    if (!raw) return showToast('Enter domains', 'warning');
    if (!ip) return showToast('Enter destination IP', 'warning');
    const names = raw.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) return showToast('No valid domains', 'warning');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';
    try {
        const r = await api.addDomains(names, ip);
        showToast(`Added ${r.added} domain(s)`, 'success');
        r.errors?.forEach(e => showToast(e, 'warning'));
        ta.value = '';
        updateManualCount();
        localStorage.setItem('dest_ip', ip);
        await loadDomains();
    } catch (e) { showToast('Add failed: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '+ Add domains'; }
}

async function bulkDelete() {
    if (!state.selectedIds.size) return;
    const ids = Array.from(state.selectedIds);
    const names = state.domains.filter(d => ids.includes(d.id)).map(d => d.name);
    const msg = `Delete ${names.length} domain(s)?\n\n${names.map(n => '• ' + n).join('\n')}`;
    if (!confirm(msg)) return;
    try {
        const r = await api.deleteDomains(ids);
        showToast(`Deleted ${r.deleted} domain(s)`, 'success');
        state.selectedIds.clear();
        updateBulkBar();
        await loadDomains();
    } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

async function deleteSingle(id) {
    const d = state.domains.find(x => x.id === id);
    if (!confirm(`Delete ${d ? d.name : 'domain #' + id}?`)) return;
    try {
        await api.deleteDomains([id]);
        showToast('Deleted', 'success');
        state.selectedIds.delete(id);
        updateBulkBar();
        await loadDomains();
    } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

// ============ Inline Editing ============
function inlineEdit(cell, id, field, currentValue) {
    if (cell.querySelector('input')) return;
    const original = cell.innerHTML;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-input';
    input.value = currentValue;
    cell.innerHTML = '';
    cell.classList.add('editing');
    cell.appendChild(input);
    input.focus();
    input.select();

    async function save() {
        const val = input.value.trim();
        if (!val || val === currentValue) { cancel(); return; }
        cell.innerHTML = '<div class="spinner spinner-light" style="width:12px;height:12px"></div>';
        try {
            await api.updateDomain(id, { [field]: val });
            showToast(`Updated ${field}`, 'success');
            await loadDomains();
        } catch (e) {
            showToast(e.message, 'error');
            cancel();
        }
    }
    function cancel() {
        cell.classList.remove('editing');
        cell.innerHTML = original;
    }
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => setTimeout(cancel, 150));
}

// ============ Generate (SSE) ============
async function startGenerate() {
    const ip = document.getElementById('ip-input').value.trim();
    if (!ip) return showToast('Set destination IP', 'warning');
    if (state.isGenerating) return;
    state.isGenerating = true;
    const gBtn = document.getElementById('generate-btn');
    const rBtn = document.getElementById('restart-btn');
    gBtn.disabled = rBtn.disabled = true;
    gBtn.innerHTML = '<div class="spinner"></div> Generating…';
    const log = document.getElementById('log-panel');
    log.classList.add('visible');
    log.innerHTML = '';
    try {
        const res = await fetch(`${API_BASE}domains/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ ip }),
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const l of lines) {
                if (l.startsWith('data: ')) {
                    try { const ev = JSON.parse(l.slice(6)); appendLog(ev.type, ev.message); } catch { }
                }
            }
        }
    } catch (e) { appendLog('error', 'Connection error: ' + e.message); }
    finally {
        state.isGenerating = false;
        gBtn.disabled = rBtn.disabled = false;
        gBtn.innerHTML = '⚡ Generate configs';
        await loadDomains();
    }
}

function appendLog(type, msg) {
    const p = document.getElementById('log-panel');
    const t = new Date().toLocaleTimeString();
    const e = document.createElement('div');
    e.className = `log-entry log-${type}`;
    e.innerHTML = `<span class="log-time">${t}</span><span>${esc(msg)}</span>`;
    p.appendChild(e);
    p.scrollTop = p.scrollHeight;
}

// ============ Restart ============
async function restartNginx() {
    const btn = document.getElementById('restart-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner spinner-light"></div> Restarting…';
    try {
        const r = await api.restartNginx();
        showToast(r.message || 'Nginx restarted', 'success');
    } catch (e) { showToast('Restart failed: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '🔄 Restart nginx'; }
}

async function checkNginxStatus() {
    try {
        const r = await api.getStatus();
        const d = document.getElementById('nginx-status-dot');
        const t = document.getElementById('nginx-status-text');
        d.className = r.running ? 'status-dot-sm' : 'status-dot-sm offline';
        t.textContent = r.running ? 'Nginx running' : 'Nginx offline';
    } catch { }
}

// ============ Theme Toggle ============
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
}

// ============ Add Tabs ============
function switchAddTab(tab, btn) {
    document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.add-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.add-tab-content#add-tab-${tab}`).classList.add('active');
    if (btn) btn.classList.add('active');
    cancelImport();
}

// ============ Manual Counter ============
function updateManualCount() {
    const ta = document.getElementById('domains-input');
    const el = document.getElementById('manual-count');
    const domains = parseDomainsFromText(ta.value);
    el.textContent = domains.length > 0 ? `${domains.length} domain(s) ready` : '';
}

// ============ Drag & Drop (textarea) ============
function setupDragDrop() {
    const zone = document.getElementById('domains-input');
    if (!zone) return;
    ['dragenter', 'dragover'].forEach(evt => {
        zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, () => zone.classList.remove('drag-over'));
    });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) readFileIntoTextarea(file);
    });
    zone.addEventListener('input', updateManualCount);

    // Import dropzone
    const importZone = document.getElementById('import-dropzone');
    if (importZone) {
        ['dragenter', 'dragover'].forEach(evt => {
            importZone.addEventListener(evt, e => { e.preventDefault(); importZone.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(evt => {
            importZone.addEventListener(evt, () => importZone.classList.remove('drag-over'));
        });
        importZone.addEventListener('drop', e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) showImportPreview(file);
        });
    }
}

function readFileIntoTextarea(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const text = e.target.result;
        const domains = parseDomainsFromText(text);
        const ta = document.getElementById('domains-input');
        ta.value = (ta.value ? ta.value + '\n' : '') + domains.join('\n');
        updateManualCount();
        showToast(`Loaded ${domains.length} domain(s) from file`, 'success');
    };
    reader.readAsText(file);
}

function parseDomainsFromText(text) {
    return text
        .split(/[\n,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s && s.includes('.') && !s.startsWith('#'));
}

// ============ Import Preview ============
let pendingImportDomains = [];

function previewImport(input) {
    if (input.files[0]) showImportPreview(input.files[0]);
    input.value = '';
}

function showImportPreview(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const text = e.target.result;
        const all = text.split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#'));
        const valid = all.filter(s => s.includes('.') && /^[a-z0-9][a-z0-9\-\.]+\.[a-z]{2,}$/.test(s));
        const invalid = all.filter(s => !valid.includes(s));
        pendingImportDomains = valid;

        const preview = document.getElementById('import-preview');
        const list = document.getElementById('import-preview-list');
        const count = document.getElementById('import-preview-count');

        count.textContent = valid.length;
        list.innerHTML =
            valid.map(d => `<div class="domain-valid">✓ ${esc(d)}</div>`).join('') +
            invalid.map(d => `<div class="domain-invalid">✗ ${esc(d)}</div>`).join('');

        preview.style.display = 'block';

        if (valid.length === 0) {
            showToast('No valid domains found in file', 'warning');
        }
    };
    reader.readAsText(file);
}

function cancelImport() {
    pendingImportDomains = [];
    document.getElementById('import-preview').style.display = 'none';
}

async function confirmImport() {
    if (!pendingImportDomains.length) return;
    const ip = document.getElementById('ip-input').value.trim();
    if (!ip) return showToast('Enter destination IP first (Step ①)', 'warning');

    const btn = document.getElementById('import-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div>';
    try {
        const r = await api.addDomains(pendingImportDomains, ip);
        showToast(`Imported ${r.added} domain(s)`, 'success');
        r.errors?.forEach(e => showToast(e, 'warning'));
        cancelImport();
        localStorage.setItem('dest_ip', ip);
        await loadDomains();
    } catch (e) { showToast('Import failed: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '✓ Add all'; }
}

// ============ Export CSV ============
function exportCSV() {
    if (!state.domains.length) return showToast('Nothing to export', 'warning');
    const header = 'ID,Domain,Dest IP,DNS IP,Status,SSL Days Left,SSL Expiry,Date Added';
    const rows = state.domains.map(d =>
        [d.id, d.name, d.ip, d.dns_ip || '', d.status, d.ssl_days_left ?? '', d.ssl_expiry || '', d.date || ''].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'domains_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast(`Exported ${state.domains.length} domains`, 'success');
}

// ============ Favicon Badge ============
function updateFavicon() {
    const failedCount = state.domains.filter(d => d.status === 'failed' || d.status === 'dns_error').length;
    const link = document.getElementById('favicon');
    if (!link) return;

    if (failedCount === 0) {
        link.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⚡</text></svg>";
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    // Base icon
    ctx.font = '24px serif';
    ctx.fillText('⚡', 2, 24);
    // Badge
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(24, 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(failedCount > 9 ? '9+' : String(failedCount), 24, 12);
    link.href = canvas.toDataURL('image/png');
}

// ============ Helpers ============
function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

window.addEventListener('DOMContentLoaded', () => {
    const ip = localStorage.getItem('dest_ip');
    if (ip) document.getElementById('ip-input').value = ip;
    init();
});
