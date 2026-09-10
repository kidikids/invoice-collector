// ניהול גיליון "מעקב חשבוניות" - שתי לשוניות:
// "חשבוניות" - יומן כל חשבונית שהתגלתה (משמש גם למניעת כפילויות, וגם להשוואת סכומים בין חודשים)
// "ספקים"    - טבלה שאתם ממלאים: שולח/דומיין -> סיסמה ידועה לקבצים המוגנים שלו

const INVOICES_TAB = 'חשבוניות';
const VENDORS_TAB = 'ספקים';

async function ensureSheetTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map((s) => s.properties.title);
  const requests = [];
  if (!existing.includes(INVOICES_TAB)) {
    requests.push({ addSheet: { properties: { title: INVOICES_TAB } } });
  }
  if (!existing.includes(VENDORS_TAB)) {
    requests.push({ addSheet: { properties: { title: VENDORS_TAB } } });
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${INVOICES_TAB}!A1:I1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        [
          'תאריך',
          'שולח',
          'שם קובץ',
          'סטטוס',
          'סיסמה',
          'קישור לדרייב',
          'Message ID',
          'סכום',
          'שינוי לעומת פעם קודמת',
        ],
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${VENDORS_TAB}!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['שולח / דומיין', 'סיסמה ידועה', 'הערות']] },
  });
}

// מחזיר מיפוי של שולח/דומיין -> סיסמה, לפי מה שמולא בלשונית "ספקים"
async function getVendorPasswords(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${VENDORS_TAB}!A2:B1000`,
  });
  const map = {};
  (res.data.values || []).forEach((row) => {
    if (row[0]) map[row[0].trim().toLowerCase()] = (row[1] || '').trim();
  });
  return map;
}

async function appendInvoiceRow(sheets, spreadsheetId, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICES_TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// שולף את כל ה-Message ID-ים שכבר תועדו, כדי לא לעבד את אותה הודעה פעמיים
async function getLoggedMessageIds(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVOICES_TAB}!G2:G200000`,
  });
  return new Set((res.data.values || []).map((r) => r[0]).filter(Boolean));
}

// בונה מיפוי של "ספק" (כתובת המייל של השולח) -> הסכום והתאריך של החשבונית
// האחרונה הידועה שלו, כדי לאפשר השוואה בין חודשים וזיהוי עליות מחיר.
function extractVendorKey(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : from || '').trim().toLowerCase();
}

async function getVendorAmountHistory(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVOICES_TAB}!A2:H200000`,
  });
  const map = {};
  (res.data.values || []).forEach((row) => {
    const dateStr = row[0];
    const from = row[1];
    const amountStr = row[7];
    if (!from || !amountStr) return;
    const amount = parseFloat(String(amountStr).replace(/,/g, ''));
    if (Number.isNaN(amount)) return;
    const key = extractVendorKey(from);
    const date = new Date(dateStr);
    if (!map[key] || date > map[key].date) {
      map[key] = { amount, date };
    }
  });
  return map;
}

module.exports = {
  INVOICES_TAB,
  VENDORS_TAB,
  ensureSheetTabs,
  getVendorPasswords,
  appendInvoiceRow,
  getLoggedMessageIds,
  getVendorAmountHistory,
  extractVendorKey,
};
