// GET /.netlify/functions/get-search-rules - כללי "כלול"/"החרג" למסך ההגדרות.
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const { ensureSheetTabs, getSearchRules } = require('./lib/sheets');

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  try {
    const spreadsheetId = process.env.INVOICE_SHEET_ID;
    if (!spreadsheetId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'חסר משתנה סביבה INVOICE_SHEET_ID' }) };
    }
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await ensureSheetTabs(sheets, spreadsheetId); // מוודא שהלשונית "כללי חיפוש" קיימת גם בפעם הראשונה
    const rules = await getSearchRules(sheets, spreadsheetId);
    return { statusCode: 200, headers, body: JSON.stringify({ rules }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
