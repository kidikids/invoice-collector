// POST /.netlify/functions/update-invoice  { messageId, driveFileId, category, paymentStatus, note }
// מעדכן קטגוריה/סטטוס תשלום/הערה לחשבונית קיימת - נקרא ממסך פרטי החשבונית בדשבורד.
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const { updateInvoiceFields } = require('./lib/sheets');

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

  const { messageId, driveFileId, category, paymentStatus, note } = body;
  if (!messageId && !driveFileId) {
    return {
      statusCode: 400,
      headers: jsonHeaders(),
      body: JSON.stringify({ error: 'חסר מזהה חשבונית (messageId או driveFileId)' }),
    };
  }

  try {
    const spreadsheetId = process.env.INVOICE_SHEET_ID;
    if (!spreadsheetId) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'חסר משתנה סביבה INVOICE_SHEET_ID' }) };
    }
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const ok = await updateInvoiceFields(sheets, spreadsheetId, { messageId, driveFileId, category, paymentStatus, note });
    if (!ok) {
      return { statusCode: 404, headers: jsonHeaders(), body: JSON.stringify({ error: 'לא נמצאה שורה מתאימה בגיליון' }) };
    }
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
