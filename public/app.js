const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const alertsWrap = document.getElementById('alertsWrap');
const tableWrap = document.getElementById('resultsTableWrap');
const dryRunBtn = document.getElementById('dryRunBtn');
const runBtn = document.getElementById('runBtn');

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
