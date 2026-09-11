// POST /.netlify/functions/save-search-rules  { rules: [{type, sender, subjectKeyword, note}] }
// שומר את כל רשימת כללי החיפוש בבת אחת (מסך ההגדרות שולח את הרשימה המלאה
// בכל שמירה - הוספה/מחיקה קורות קודם בצד הלקוח).
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const {
  ensureSheetTabs,
  setSearchRules,
  RULE_TYPE_INCLUDE,
  RULE_TYPE_EXCLUDE,
} = require('./lib/sheets');

function jsonHeaders() {
  return { 'Content-Type': 'application/json; charset=utf-8' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'גוף בקשה לא תקין' }) };
  }

  const rules = Array.isArray(body.rules) ? body.rules : null;
  if (!rules) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'רשימת כללים חסרה' }) };
  }

  const validTypes = [RULE_TYPE_INCLUDE, RULE_TYPE_EXCLUDE];
  for (const r of rules) {
    if (!validTypes.includes(r.type)) {
      return {
        statusCode: 400,
        headers: jsonHeaders(),
        body: JSON.stringify({ error: `סוג כלל לא תקין: ${r.type}` }),
      };
    }
    if (!r.sender && !r.subjectKeyword) {
      return {
        statusCode: 400,
        headers: jsonHeaders(),
        body: JSON.stringify({ error: 'לכל כלל צריך למלא לפחות שולח/דומיין או מילת מפתח בנושא' }),
      };
    }
  }

  try {
    const spreadsheetId = process.env.INVOICE_SHEET_ID;
    if (!spreadsheetId) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'חסר משתנה סביבה INVOICE_SHEET_ID' }) };
    }
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await ensureSheetTabs(sheets, spreadsheetId);
    await setSearchRules(sheets, spreadsheetId, rules);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true, count: rules.length }) };
  } catch (err) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
