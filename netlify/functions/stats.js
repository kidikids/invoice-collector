// GET /.netlify/functions/stats - סטטיסטיקות והוצאות מתוך יומן החשבוניות שכבר תועד.
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const { INVOICES_TAB } = require('./lib/sheets');
const { buildStats } = require('./lib/stats');

exports.handler = async () => {
  try {
    const spreadsheetId = process.env.INVOICE_SHEET_ID;
    if (!spreadsheetId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'חסר משתנה סביבה INVOICE_SHEET_ID' }),
      };
    }
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${INVOICES_TAB}!A2:I200000`,
    });
    const stats = buildStats(res.data.values || []);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(stats),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
