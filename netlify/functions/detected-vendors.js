// GET /.netlify/functions/detected-vendors
// מזהה ספקים שכבר הופיעו בהיסטוריית החשבוניות שנמשכו, כדי לאפשר למשתמש לבחור מהם
// ולהוסיף אותם לרשימת המשיכה הקבועה (כלל "כלול") - בלי להקליד כתובת מייל ידנית.
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const {
  ensureSheetTabs,
  getAllInvoiceRows,
  getVendorPasswords,
  getSearchRules,
  extractVendorKey,
  RULE_TYPE_INCLUDE,
} = require('./lib/sheets');

// מוציא שם תצוגה נעים מתוך כותרת "From" גולמית - "שם" <email> -> "שם", ואם אין שם, הכתובת עצמה.
function displayNameFromFrom(from) {
  const m = String(from || '').match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  if (m && m[1].trim()) return m[1].trim();
  return String(from || '').trim();
}

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  try {
    const spreadsheetId = process.env.INVOICE_SHEET_ID;
    if (!spreadsheetId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'חסר משתנה סביבה INVOICE_SHEET_ID' }) };
    }
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await ensureSheetTabs(sheets, spreadsheetId);

    const [rows, vendorPasswords, searchRules] = await Promise.all([
      getAllInvoiceRows(sheets, spreadsheetId),
      getVendorPasswords(sheets, spreadsheetId),
      getSearchRules(sheets, spreadsheetId),
    ]);

    const registeredKeys = new Set(Object.keys(vendorPasswords));
    const includeSenders = searchRules
      .filter((r) => r.type === RULE_TYPE_INCLUDE && r.sender)
      .map((r) => r.sender.trim().toLowerCase());

    function isRegistered(key, domain) {
      if (registeredKeys.has(key) || (domain && registeredKeys.has(domain))) return true;
      return includeSenders.some((s) => key.includes(s) || (domain && domain.includes(s)));
    }

    const map = {};
    rows.forEach((row) => {
      const from = row[1];
      // חשבוניות שסומנו כ"שיתוף עצמי" (למשל הועברו מוואטסאפ) מוצגות עם שם ספק
      // שחולץ מהנושא ולא עם כתובת מייל אמיתית - אי אפשר לרשום אותן לחיפוש יזום לפי שולח.
      if (!from || !from.includes('@')) return;
      const key = extractVendorKey(from);
      if (!key) return;
      const domainMatch = key.match(/@([\w.-]+)/);
      const domain = domainMatch ? domainMatch[1].toLowerCase() : '';
      if (!map[key]) {
        map[key] = { key, domain, displayName: displayNameFromFrom(from), count: 0 };
      }
      map[key].count++;
    });

    const vendors = Object.values(map)
      .map((v) => ({ ...v, registered: isRegistered(v.key, v.domain) }))
      .sort((a, b) => b.count - a.count);

    return { statusCode: 200, headers, body: JSON.stringify({ vendors }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
