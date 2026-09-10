// ניהול גיליון "מעקב חשבוניות" - שתי לשוניות:
// "חשבוניות" - יומן כל חשבונית שהתגלתה (משמש גם למניעת כפילויות)
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
    range: `${INVOICES_TAB}!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['תאריך', 'שולח', 'שם קובץ', 'סטטוס', 'סיסמה', 'קישור לדרייב', 'Message ID']],
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

module.exports = {
  INVOICES_TAB,
  VENDORS_TAB,
  ensureSheetTabs,
  getVendorPasswords,
  appendInvoiceRow,
  getLoggedMessageIds,
};
