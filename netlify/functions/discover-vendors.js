// GET /.netlify/functions/discover-vendors?daysBack=180&term=בזק
// "הספקים הקבועים שלי" מציג רק שולחים שכבר תועדו בגיליון. הפונקציה הזו עושה
// משהו רחב יותר: סורקת ישירות ב-Gmail בטווח הנבחר. בלי פרמטר term - סורקת כל
// הודעה עם קובץ PDF מצורף, בלי תלות במילה "חשבונית" בכותרת. עם term - מחפשת
// את השם/המילה שהוזנו (שם ספק, מילת מפתח, כתובת מייל וכו') בכל שדות ההודעה,
// בדיוק כמו חיפוש רגיל ב-Gmail - שימושי כשמחפשים ספק ספציפי בשם שיודעים.
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const { searchInvoiceMessages, getMessageMeta, findHeader } = require('./lib/gmail');
const { withRetry, isQuotaError } = require('./lib/apiRetry');
const {
  ensureSheetTabs,
  getAllInvoiceRows,
  getVendorPasswords,
  getSearchRules,
  extractVendorKey,
  RULE_TYPE_INCLUDE,
} = require('./lib/sheets');

// שמרני בכוונה - סריקה כזו עושה עד MAX_MESSAGES קריאות API בנפרד (רק מטא-דאטה,
// לא הודעה מלאה), כדי לא לחרוג מזמן הריצה של פונקציית Netlify או ממכסת Gmail.
// CONCURRENCY נמוך יחסית (ולא למשל 8-10) כדי לא לגרום לשגיאת "Quota exceeded...
// Units per minute per user" כשסורקים טווח רחב - כל קריאה כבר עטופה גם בניסיון
// חוזר אוטומטי (ראו lib/gmail.js), אבל עדיף למנוע את זה מראש.
const MAX_MESSAGES = 100;
const CONCURRENCY = 3;
const MAX_VENDORS_RETURNED = 40;
const MAX_DAYS_BACK = 730;

function displayNameFromFrom(from) {
  const m = String(from || '').match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  if (m && m[1].trim()) return m[1].trim();
  return String(from || '').trim();
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  try {
    const spreadsheetId = process.env.INVOICE_SHEET_ID;
    if (!spreadsheetId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'חסר משתנה סביבה INVOICE_SHEET_ID' }) };
    }
    const params = event.queryStringParameters || {};
    const daysBack = Math.min(Math.max(Number(params.daysBack) || 180, 1), MAX_DAYS_BACK);
    const term = (params.term || '').trim();

    const auth = getOAuthClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    await ensureSheetTabs(sheets, spreadsheetId);

    // כתובת המייל של החשבון המחובר עצמו - כדי להתעלם מהודעות "שיתוף עצמי"
    // (למשל וואטסאפ שהועבר ל-Gmail), בדיוק כמו ב"הספקים הקבועים שלי".
    let selfEmail = '';
    try {
      const profile = await withRetry(() => gmail.users.getProfile({ userId: 'me' }));
      selfEmail = (profile.data.emailAddress || '').trim().toLowerCase();
    } catch (e) {
      selfEmail = '';
    }

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

    const loggedVendorKeys = new Set();
    rows.forEach((row) => {
      const from = row[1];
      if (from && from.includes('@')) loggedVendorKeys.add(extractVendorKey(from));
    });

    const query = term ? `${term} newer_than:${daysBack}d` : `has:attachment filename:pdf newer_than:${daysBack}d`;
    const messages = await searchInvoiceMessages(gmail, { query, maxResults: MAX_MESSAGES });

    const map = {};
    await mapWithConcurrency(messages, CONCURRENCY, async (m) => {
      let data;
      try {
        data = await getMessageMeta(gmail, m.id, ['From', 'Subject']);
      } catch (e) {
        return; // הודעה בודדת שנכשלה (גם אחרי ניסיון חוזר) לא צריכה להפיל את כל הסריקה
      }
      const from = findHeader(data.payload.headers, 'From');
      if (!from || !from.includes('@')) return;
      const fromEmailMatch = (from.match(/<([^>]+)>/) || [])[1] || from;
      if (selfEmail && fromEmailMatch.trim().toLowerCase() === selfEmail) return;
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
      .map((v) => ({
        ...v,
        registered: isRegistered(v.key, v.domain),
        everLogged: loggedVendorKeys.has(v.key),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_VENDORS_RETURNED);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        vendors,
        scannedMessages: messages.length,
        truncated: messages.length >= MAX_MESSAGES,
        usedTerm: term || null,
      }),
    };
  } catch (err) {
    if (isQuotaError(err)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error:
            'חריגה זמנית ממכסת השימוש ב-Gmail (קורה כשסורקים הרבה הודעות בבת אחת). המערכת כבר ניסתה שוב כמה פעמים לבד, אך המכסה עדיין עמוסה - חכו 2-3 דקות ונסו שוב, אפשר גם עם טווח קצר יותר.',
        }),
      };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
