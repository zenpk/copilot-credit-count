import * as vscode from 'vscode';
import type { CreditsStorage } from './storage';

let panel: vscode.WebviewPanel | undefined;

export function showDashboard(context: vscode.ExtensionContext, storage: CreditsStorage): void {
  if (panel) {
    panel.reveal();
    sendData(panel, storage);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'copilot-credit-count.dashboard',
    'Copilot Credit Count',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = getHtml(panel.webview);
  sendData(panel, storage);

  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    null,
    context.subscriptions,
  );
}

export function refreshDashboard(storage: CreditsStorage): void {
  if (panel) {
    sendData(panel, storage);
  }
}

function sendData(p: vscode.WebviewPanel, storage: CreditsStorage): void {
  p.webview.postMessage({
    type: 'data',
    entries: storage.getAll(),
    months: storage.getAvailableMonths(),
    models: storage.getAvailableModels(),
  });
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copilot Credit Count</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px 24px;
      line-height: 1.5;
    }

    h1 {
      font-size: 1.4em;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h1 .icon { opacity: 0.7; }

    .summary-row {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .summary-card {
      flex: 1;
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
      border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
      border-radius: 8px;
      padding: 14px 18px;
    }

    .summary-card .value {
      font-size: 1.8em;
      font-weight: 700;
      color: var(--vscode-textLink-foreground, #4fc1ff);
      font-variant-numeric: tabular-nums;
    }

    .summary-card .label {
      font-size: 0.82em;
      opacity: 0.6;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .controls {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
      align-items: center;
    }

    .control-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .control-group label {
      font-size: 0.85em;
      opacity: 0.7;
      white-space: nowrap;
    }

    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, rgba(255,255,255,0.1));
      padding: 5px 10px;
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      cursor: pointer;
      outline: none;
    }
    select:focus {
      border-color: var(--vscode-focusBorder);
    }

    .section-title {
      font-size: 0.82em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.5;
      margin-bottom: 8px;
    }

    .breakdown-section { margin-bottom: 20px; }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 2px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
      font-weight: 600;
      font-size: 0.8em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.6;
      white-space: nowrap;
    }
    th.right { text-align: right; }

    td {
      padding: 7px 12px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.05));
      vertical-align: middle;
    }

    tbody tr:hover td {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .credit-value {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

    .model-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.88em;
      font-weight: 500;
      white-space: nowrap;
    }

    .context-cell {
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.8;
    }

    .date-cell {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .muted { opacity: 0.4; }

    .empty-state {
      text-align: center;
      padding: 48px 20px;
      opacity: 0.45;
      font-size: 1.05em;
    }

    .breakdown-table th,
    .breakdown-table td {
      padding: 5px 12px;
    }
    .breakdown-table {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <h1><span class="icon">&#9889;</span> Copilot Credit Count</h1>

  <div class="summary-row">
    <div class="summary-card">
      <div class="value" id="total-credits">—</div>
      <div class="label">Total Credits</div>
    </div>
    <div class="summary-card">
      <div class="value" id="total-requests">—</div>
      <div class="label">Requests</div>
    </div>
    <div class="summary-card">
      <div class="value" id="unique-models">—</div>
      <div class="label">Models</div>
    </div>
  </div>

  <div class="controls">
    <div class="control-group">
      <label for="month-filter">Month</label>
      <select id="month-filter"><option value="">All months</option></select>
    </div>
    <div class="control-group">
      <label for="model-filter">Model</label>
      <select id="model-filter"><option value="">All models</option></select>
    </div>
    <div class="control-group">
      <label for="sort-by">Sort</label>
      <select id="sort-by">
        <option value="date-desc">Date (newest)</option>
        <option value="date-asc">Date (oldest)</option>
        <option value="credits-desc">Credits (highest)</option>
        <option value="credits-asc">Credits (lowest)</option>
      </select>
    </div>
  </div>

  <div class="breakdown-section" id="breakdown-section">
    <div class="section-title">By Model</div>
    <div id="model-breakdown"></div>
  </div>

  <div class="section-title" id="entries-title">Entries</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Model</th>
        <th class="right">Credits</th>
        <th>Context</th>
      </tr>
    </thead>
    <tbody id="entries-tbody">
      <tr><td colspan="4" class="empty-state">Waiting for data…</td></tr>
    </tbody>
  </table>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let allEntries = [];
    let allMonths = [];
    let allModels = [];

    const monthFilter = document.getElementById('month-filter');
    const modelFilter = document.getElementById('model-filter');
    const sortBy = document.getElementById('sort-by');

    monthFilter.addEventListener('change', render);
    modelFilter.addEventListener('change', render);
    sortBy.addEventListener('change', render);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'data') {
        allEntries = msg.entries || [];
        allMonths = msg.months || [];
        allModels = msg.models || [];
        populateFilters();
        render();
      }
    });

    function populateFilters() {
      const prevMonth = monthFilter.value;
      const prevModel = modelFilter.value;

      monthFilter.innerHTML = '<option value="">All months</option>';
      for (const m of allMonths) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = formatMonthLabel(m);
        monthFilter.appendChild(opt);
      }
      monthFilter.value = allMonths.includes(prevMonth) ? prevMonth : '';

      modelFilter.innerHTML = '<option value="">All models</option>';
      for (const m of allModels) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelFilter.appendChild(opt);
      }
      modelFilter.value = allModels.includes(prevModel) ? prevModel : '';
    }

    function getFilteredEntries() {
      const month = monthFilter.value;
      const model = modelFilter.value;
      const sort = sortBy.value;

      let entries = allEntries;

      if (month) {
        entries = entries.filter(e => {
          const d = new Date(e.timestamp);
          const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          return m === month;
        });
      }

      if (model) {
        entries = entries.filter(e => e.model === model);
      }

      entries = [...entries];
      switch (sort) {
        case 'date-desc':
          entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          break;
        case 'date-asc':
          entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          break;
        case 'credits-desc':
          entries.sort((a, b) => b.credits - a.credits);
          break;
        case 'credits-asc':
          entries.sort((a, b) => a.credits - b.credits);
          break;
      }

      return entries;
    }

    function render() {
      const entries = getFilteredEntries();

      const total = entries.reduce((s, e) => s + (e.credits || 0), 0);
      const models = new Set(entries.map(e => e.model).filter(Boolean));

      document.getElementById('total-credits').textContent = total.toFixed(1);
      document.getElementById('total-requests').textContent = String(entries.length);
      document.getElementById('unique-models').textContent = String(models.size);

      renderBreakdown(entries);
      renderTable(entries);
    }

    function renderBreakdown(entries) {
      const byModel = {};
      for (const e of entries) {
        const m = e.model || 'unknown';
        if (!byModel[m]) byModel[m] = { count: 0, credits: 0 };
        byModel[m].count++;
        byModel[m].credits += e.credits || 0;
      }

      const section = document.getElementById('breakdown-section');
      const container = document.getElementById('model-breakdown');
      const keys = Object.keys(byModel);

      if (keys.length === 0) {
        section.style.display = 'none';
        return;
      }
      section.style.display = '';

      const sorted = keys
        .map(k => ({ model: k, ...byModel[k] }))
        .sort((a, b) => b.credits - a.credits);

      let html = '<table class="breakdown-table"><thead><tr>';
      html += '<th>Model</th><th class="right">Requests</th><th class="right">Credits</th><th class="right">Avg</th>';
      html += '</tr></thead><tbody>';

      for (const row of sorted) {
        const avg = row.count > 0 ? (row.credits / row.count).toFixed(3) : '0.000';
        const color = modelColor(row.model);
        html += '<tr>';
        html += '<td><span class="model-badge" style="background:' + color + '">' + esc(row.model) + '</span></td>';
        html += '<td class="credit-value">' + row.count + '</td>';
        html += '<td class="credit-value">' + row.credits.toFixed(3) + '</td>';
        html += '<td class="credit-value">' + avg + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table>';
      container.innerHTML = html;
    }

    function renderTable(entries) {
      const tbody = document.getElementById('entries-tbody');

      if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No entries found</td></tr>';
        document.getElementById('entries-title').textContent = 'Entries';
        return;
      }

      document.getElementById('entries-title').textContent = 'Entries (' + entries.length + ')';

      let html = '';
      for (const e of entries) {
        const date = formatDate(e.timestamp);
        const model = e.model || '';
        const color = model ? modelColor(model) : '';
        html += '<tr>';
        html += '<td class="date-cell">' + esc(date) + '</td>';
        html += '<td>' + (model
          ? '<span class="model-badge" style="background:' + color + '">' + esc(model) + '</span>'
          : '<span class="muted">—</span>') + '</td>';
        html += '<td class="credit-value">' + (e.credits || 0).toFixed(3) + '</td>';
        html += '<td class="context-cell" title="' + attr(e.context || '') + '">' + esc(e.context || '—') + '</td>';
        html += '</tr>';
      }

      tbody.innerHTML = html;
    }

    function formatDate(iso) {
      const d = new Date(iso);
      const year = d.getFullYear();
      const mon = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return year + '-' + mon + '-' + day + ' ' + h + ':' + m;
    }

    function formatMonthLabel(m) {
      const [year, month] = m.split('-').map(Number);
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return names[month - 1] + ' ' + year;
    }

    function modelColor(model) {
      let hash = 0;
      for (let i = 0; i < model.length; i++) {
        hash = model.charCodeAt(i) + ((hash << 5) - hash);
      }
      const h = Math.abs(hash) % 360;
      return 'hsla(' + h + ', 55%, 55%, 0.18)';
    }

    function esc(s) {
      const el = document.createElement('span');
      el.textContent = s;
      return el.innerHTML;
    }

    function attr(s) {
      return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>`;
}
