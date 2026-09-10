const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
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
  ];
  summaryEl.innerHTML = stats
    .map(([label, num]) => `<div class="stat"><span class="num">${num ?? 0}</span><span class="label">${label}</span></div>`)
    .join('');
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
        <td>${it.driveLink ? `<a href="${it.driveLink}" target="_blank">פתיחה בדרייב</a>` : it.link ? `<a href="${it.link}" target="_blank">פתיחת קישור</a>` : ''}</td>
      </tr>`
    )
    .join('');
  tableWrap.innerHTML = `<table>
    <thead><tr><th>שולח</th><th>קובץ / הערה</th><th>סטטוס</th><th>קישור</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function trigger(dryRun) {
  setBusy(true, dryRun ? 'מריץ בדיקה יבשה...' : 'מריץ סנכרון אמיתי - מוריד ומעלה קבצים...');
  summaryEl.innerHTML = '';
  tableWrap.innerHTML = '';
  try {
    const res = await fetch(`/.netlify/functions/sync-invoices?dryRun=${dryRun}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה לא ידועה');
    renderSummary(data);
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
