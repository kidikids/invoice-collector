// --- ניווט בין העמודים בסיידבר ---
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => (p.hidden = true));
    const target = document.getElementById('page-' + btn.dataset.page);
    if (target) target.hidden = false;
  });
});

const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const alertsWrap = document.getElementById('alertsWrap');
const tableWrap = document.getElementById('resultsTableWrap');
const dryRunBtn = document.getElementById('dryRunBtn');
const runBtn = document.getElementById('runBtn');
const statsStatusEl = document.getElementById('statsStatus');
const statsBodyEl = document.getElementById('statsBody');
const kpiGridEl = document.getElementById('kpiGrid');
const recentIncreasesWrap = document.getElementById('recentIncreasesWrap');
const refreshStatsBtn = document.getElementById('refreshStatsBtn');

let monthlyChartInstance = null;
let vendorChartInstance = null;

function fmtIls(n) {
  return `${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₪`;
}

function kpiCard(label, value, sub, warn) {
  return `<div class="kpi-card${warn ? ' kpi-warn' : ''}">
    <div class="kpi-value">${value}</div>
    <div class="kpi-label">${label}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

function renderKpis(s) {
  const pct = s.monthOverMonthPct;
  const pctText =
    pct == null ? 'אין עדיין נתון לחודש קודם' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% לעומת החודש הקודם`;
  kpiGridEl.innerHTML = [
    kpiCard('הוצאה החודש', fmtIls(s.thisMonthTotal), pctText, pct != null && pct > 0),
    kpiCard('סה"כ מתועד', fmtIls(s.totalAllTime), `${s.invoiceCount} חשבוניות`),
    kpiCard('ספקים במעקב', s.vendorCount, ''),
    kpiCard('עליות מחיר שזוהו', s.priceIncreaseCount, '', s.priceIncreaseCount > 0),
    kpiCard('ממתין לסיסמה', s.encryptedPendingCount, '', s.encryptedPendingCount > 0),
  ].join('');
}

function renderMonthlyChart(months) {
  const ctx = document.getElementById('monthlyChart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (monthlyChartInstance) monthlyChartInstance.destroy();
  monthlyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          label: 'הוצאה חודשית',
          data: months.map((m) => m.total),
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79,70,229,0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#4f46e5',
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmtIls(v) } } },
    },
  });
}

function renderVendorChart(topVendors) {
  const ctx = document.getElementById('vendorChart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (vendorChartInstance) vendorChartInstance.destroy();
  vendorChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: topVendors.map((v) => v.name),
      datasets: [
        {
          label: 'סה"כ',
          data: topVendors.map((v) => v.total),
          backgroundColor: '#0ea5e9',
          borderRadius: 6,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmtIls(v) } } },
    },
  });
}

function renderRecentIncreases(list) {
  if (!list || !list.length) {
    recentIncreasesWrap.innerHTML = '';
    return;
  }
  const rows = list
    .map(
      (r) => `<tr>
        <td>${r.date}</td>
        <td>${r.vendor}</td>
        <td>${r.changeLabel}</td>
        <td>${r.driveLink ? `<a href="${r.driveLink}" target="_blank">פתיחה</a>` : ''}</td>
      </tr>`
    )
    .join('');
  recentIncreasesWrap.innerHTML = `<h4 class="sub-title">היסטוריית עליות מחיר</h4>
    <table>
      <thead><tr><th>תאריך</th><th>ספק</th><th>שינוי</th><th>קישור</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function loadStats() {
  statsStatusEl.textContent = 'טוען נתונים...';
  statsStatusEl.hidden = false;
  statsBodyEl.hidden = true;
  try {
    const res = await fetch('/.netlify/functions/stats');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה בטעינת סטטיסטיקות');
    if (!data.invoiceCount) {
      statsStatusEl.textContent = 'עדיין אין נתונים - הריצו סנכרון אמיתי כדי להתחיל לראות סטטיסטיקות.';
      return;
    }
    renderKpis(data);
    renderMonthlyChart(data.months);
    renderVendorChart(data.topVendors);
    renderRecentIncreases(data.recentIncreases);
    statsStatusEl.hidden = true;
    statsBodyEl.hidden = false;
  } catch (err) {
    statsStatusEl.textContent = 'שגיאה בטעינת סטטיסטיקות: ' + err.message;
  }
}

refreshStatsBtn.addEventListener('click', loadStats);
loadStats();

// --- הדפסה והורדה לרו"ח ---
const invoiceListWrap = document.getElementById('invoiceListWrap');
const monthFilter = document.getElementById('monthFilter');
const selectAllBtn = document.getElementById('selectAllBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const mergePrintBtn = document.getElementById('mergePrintBtn');
const exportStatus = document.getElementById('exportStatus');
const refreshInvoiceListBtn = document.getElementById('refreshInvoiceListBtn');

let allInvoices = [];

function invoiceMonthKey(dateStr) {
  return (dateStr || '').slice(0, 7);
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

function renderInvoiceList() {
  const filterVal = monthFilter.value;
  const filtered = filterVal ? allInvoices.filter((it) => invoiceMonthKey(it.date) === filterVal) : allInvoices;
  if (!filtered.length) {
    invoiceListWrap.innerHTML = '<p>אין חשבוניות להצגה בטווח הזה.</p>';
    return;
  }
  const rows = filtered
    .map(
      (it) => `<tr>
        <td><input type="checkbox" class="invoice-check" data-id="${it.driveFileId}" data-filename="${escapeAttr(it.filename)}"></td>
        <td>${it.date}</td>
        <td>${it.from}</td>
        <td>${it.filename}</td>
        <td>${it.amount ? it.amount + ' ₪' : ''}</td>
      </tr>`
    )
    .join('');
  invoiceListWrap.innerHTML = `<table>
    <thead><tr><th></th><th>תאריך</th><th>שולח</th><th>קובץ</th><th>סכום</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function populateMonthFilter() {
  const months = [...new Set(allInvoices.map((it) => invoiceMonthKey(it.date)))].filter(Boolean).sort().reverse();
  monthFilter.innerHTML =
    '<option value="">כל החודשים</option>' + months.map((m) => `<option value="${m}">${m}</option>`).join('');
}

async function loadInvoiceList() {
  invoiceListWrap.innerHTML = '<p>טוען רשימה...</p>';
  try {
    const res = await fetch('/.netlify/functions/list-invoices');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה');
    allInvoices = data.items || [];
    populateMonthFilter();
    renderInvoiceList();
  } catch (err) {
    invoiceListWrap.innerHTML = `<p style="color:#b91c1c">שגיאה: ${err.message}</p>`;
  }
}

function getSelectedFiles() {
  return Array.from(document.querySelectorAll('.invoice-check:checked')).map((cb) => ({
    id: cb.dataset.id,
    filename: cb.dataset.filename,
  }));
}

function base64ToBlobUrl(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  return URL.createObjectURL(blob);
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function exportSelected(mode) {
  const files = getSelectedFiles();
  if (!files.length) {
    exportStatus.textContent = 'לא נבחרו חשבוניות.';
    return;
  }
  exportStatus.textContent = mode === 'zip' ? 'מכין קובץ ZIP...' : 'ממזג PDF להדפסה...';
  try {
    const res = await fetch('/.netlify/functions/export-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה');
    const url = base64ToBlobUrl(data.base64, data.mimeType);
    if (mode === 'zip') {
      triggerDownload(url, data.filename);
      exportStatus.textContent = `הורד: ${data.filename} (${files.length} חשבוניות)`;
    } else {
      window.open(url, '_blank');
      const skippedMsg =
        data.skipped && data.skipped.length
          ? ` דולגו ${data.skipped.length} קבצים (מוצפנים/פגומים): ${data.skipped.join(', ')}.`
          : '';
      exportStatus.innerHTML = `ה-PDF הממוזג נפתח בכרטיסייה חדשה - אפשר להדפיס משם.${skippedMsg} <a href="${url}" download="${data.filename}">הורדת הקובץ</a>`;
    }
  } catch (err) {
    exportStatus.textContent = 'שגיאה: ' + err.message;
  }
}

monthFilter.addEventListener('change', renderInvoiceList);
selectAllBtn.addEventListener('click', () => {
  invoiceListWrap.querySelectorAll('.invoice-check').forEach((cb) => (cb.checked = true));
});
clearSelectionBtn.addEventListener('click', () => {
  invoiceListWrap.querySelectorAll('.invoice-check').forEach((cb) => (cb.checked = false));
});
downloadZipBtn.addEventListener('click', () => exportSelected('zip'));
mergePrintBtn.addEventListener('click', () => exportSelected('merge'));
refreshInvoiceListBtn.addEventListener('click', loadInvoiceList);
loadInvoiceList();

function setBusy(busy, msg) {
  dryRunBtn.disabled = busy;
  runBtn.disabled = busy;
  statusEl.textContent = msg || '';
}

function renderSummary(r) {
  const stats = [
    ['נמצאו', r.matched],
    ['הורדו', r.downloaded],
    ['מוצפנים', r.encrypted],
    ['דורש בדיקה', r.needsReview],
    ['כבר תועדו קודם', r.skippedAlready],
    ['עליות מחיר', r.priceIncreases],
  ];
  summaryEl.innerHTML = stats
    .map(
      ([label, num]) =>
        `<div class="stat${label === 'עליות מחיר' && num > 0 ? ' stat-warn' : ''}"><span class="num">${num ?? 0}</span><span class="label">${label}</span></div>`
    )
    .join('');
}

function renderAlerts(alerts) {
  if (!alerts || !alerts.length) {
    alertsWrap.innerHTML = '';
    return;
  }
  const cards = alerts
    .map((a) => {
      const pct = a.pct != null ? `+${a.pct.toFixed(1)}%` : '';
      const linkHtml = a.driveLink ? `<a href="${a.driveLink}" target="_blank">פתיחת החשבונית</a>` : '';
      return `<div class="alert-card">
        <div class="alert-title">⚠ עלייה בסכום החיוב</div>
        <div class="alert-body">
          <span class="alert-from">${a.from || ''}</span>
          <span class="alert-amounts">${a.previousAmount.toFixed(2)} ₪ &larr; ${a.newAmount.toFixed(2)} ₪ <b>(${pct})</b></span>
          ${linkHtml}
        </div>
      </div>`;
    })
    .join('');
  alertsWrap.innerHTML = `<div class="alerts-box">
    <h4>התראות - שינויים בסכומי חיוב (${alerts.length})</h4>
    ${cards}
  </div>`;
}

function changeBadge(it) {
  if (!it.changeLabel) return '';
  if (it.changeLabel.startsWith('עלייה')) return `<span class="badge err">${it.changeLabel}</span>`;
  if (it.changeLabel.startsWith('ירידה')) return `<span class="badge ok">${it.changeLabel}</span>`;
  return `<span class="badge neutral">${it.changeLabel}</span>`;
}

function badge(item) {
  if (item.encrypted) return `<span class="badge warn">מוצפן${item.hasKnownPassword ? ' - סיסמה ידועה' : ' - נדרשת סיסמה'}</span>`;
  if (item.mode === 'link-manual' || item.mode === 'link-error' || item.mode === 'none') {
    return `<span class="badge err">דורש בדיקה ידנית</span>`;
  }
  return `<span class="badge ok">הורד בהצלחה</span>`;
}

function renderTable(items) {
  if (!items || !items.length) {
    tableWrap.innerHTML = '<p>לא נמצאו הודעות חדשות תואמות.</p>';
    return;
  }
  const rows = items
    .map(
      (it) => `<tr>
        <td>${it.from || ''}</td>
        <td>${it.filename || it.note || ''}</td>
        <td>${badge(it)}</td>
        <td>${it.amount != null ? it.amount.toFixed(2) + ' ₪' : ''}</td>
        <td>${changeBadge(it)}</td>
        <td>${it.driveLink ? `<a href="${it.driveLink}" target="_blank">פתיחה בדרייב</a>` : it.link ? `<a href="${it.link}" target="_blank">פתיחת קישור</a>` : ''}</td>
      </tr>`
    )
    .join('');
  tableWrap.innerHTML = `<table>
    <thead><tr><th>שולח</th><th>קובץ / הערה</th><th>סטטוס</th><th>סכום</th><th>שינוי</th><th>קישור</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function trigger(dryRun) {
  setBusy(true, dryRun ? 'מריץ בדיקה יבשה...' : 'מריץ סנכרון אמיתי - מוריד ומעלה קבצים...');
  summaryEl.innerHTML = '';
  alertsWrap.innerHTML = '';
  tableWrap.innerHTML = '';
  try {
    const res = await fetch(`/.netlify/functions/sync-invoices?dryRun=${dryRun}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה לא ידועה');
    renderSummary(data);
    renderAlerts(data.alerts);
    renderTable(data.items);
    setBusy(false, dryRun ? 'הבדיקה היבשה הושלמה - שום דבר לא נשמר בפועל.' : 'הסנכרון הושלם.');
  } catch (err) {
    setBusy(false, '');
    tableWrap.innerHTML = `<p style="color:#b91c1c">שגיאה: ${err.message}</p>`;
  }
}

dryRunBtn.addEventListener('click', () => trigger(true));
runBtn.addEventListener('click', () => {
  if (confirm('להריץ סנכרון אמיתי? הפעולה תוריד קבצים ותעדכן את הדרייב והגיליון.')) {
    trigger(false);
  }
});
