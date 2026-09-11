// GET /.netlify/functions/list-invoices - רשימת כל החשבוניות שתועדו, לצורך מסך
// "הדפסה והורדה לרו"ח" (בחירה, הורדת ZIP, מיזוג להדפסה).
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const { getAllInvoiceRows } = require('./lib/sheets');

function extractFileIdFromLink(link) {
  const m = String(link || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
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
    const rows = await getAllInvoiceRows(sheets, spreadsheetId);

    const items = rows
      .map((row) => ({
        date: row[0] || '',
        from: row[1] || '',
        filename: row[2] || '',
        status: row[3] || '',
        driveLink: row[5] || '',
        messageId: row[6] || '',
        amount: row[7] || '',
        changeLabel: row[8] || '',
        driveFileId: row[9] || extractFileIdFromLink(row[5]),
        category: row[10] || '',
        paymentStatus: row[11] || '',
        note: row[12] || '',
      }))
      .filter((it) => it.driveFileId) // רק שורות עם קובץ אמיתי בדרייב (לא קישורי הורדה ידנית)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return { statusCode: 200, headers, body: JSON.stringify({ items }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
