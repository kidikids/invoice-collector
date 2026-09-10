// POST /.netlify/functions/export-invoices  { files: [{id, filename}], mode: 'zip' | 'merge' }
// מוריד את הקבצים הנבחרים מ-Drive, ומחזיר או ZIP של כולם, או PDF ממוזג אחד
// (להדפסה מרוכזת - קבצים מוצפנים מדולגים מהמיזוג ומדווחים כ"skipped").
const { google } = require('googleapis');
const { getOAuthClient } = require('./lib/googleAuth');
const { isPdfEncrypted } = require('./lib/pdfCheck');
const { buildZip, mergePdfs } = require('./lib/pdfExport');

// מגבלות שמרניות כדי להישאר בתוך גבול התגובה של Netlify Functions (כ-6MB) -
// לבחירה גדולה יותר, פצלו את הייצוא (למשל לפי חודש).
const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024;

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

  const { files: requested, mode } = body;
  if (!Array.isArray(requested) || !requested.length) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'לא נבחרו קבצים' }) };
  }
  if (requested.length > MAX_FILES) {
    return {
      statusCode: 400,
      headers: jsonHeaders(),
      body: JSON.stringify({
        error: `נבחרו יותר מדי קבצים (${requested.length}). בחרו עד ${MAX_FILES} בכל פעם - למשל חודש אחד בלבד.`,
      }),
    };
  }

  try {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const downloaded = await Promise.all(
      requested
        .filter((item) => item && item.id)
        .map(async (item) => {
          const res = await drive.files.get({ fileId: item.id, alt: 'media' }, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(res.data);
          return { filename: item.filename || `${item.id}.pdf`, buffer, encrypted: isPdfEncrypted(buffer) };
        })
    );

    const totalBytes = downloaded.reduce((sum, f) => sum + f.buffer.length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return {
        statusCode: 400,
        headers: jsonHeaders(),
        body: JSON.stringify({
          error: 'הבחירה גדולה מדי לעיבוד בבת אחת (יותר מכ-3.5MB). בחרו טווח קטן יותר, למשל חודש אחד.',
        }),
      };
    }

    if (mode === 'zip') {
      const zipBuffer = await buildZip(downloaded.map((f) => ({ filename: f.filename, buffer: f.buffer })));
      return {
        statusCode: 200,
        headers: jsonHeaders(),
        body: JSON.stringify({
          filename: 'חשבוניות.zip',
          mimeType: 'application/zip',
          base64: zipBuffer.toString('base64'),
          skipped: [],
        }),
      };
    }

    if (mode === 'merge') {
      const encryptedSkipped = downloaded.filter((f) => f.encrypted).map((f) => f.filename);
      const mergeable = downloaded.filter((f) => !f.encrypted);
      if (!mergeable.length) {
        return {
          statusCode: 400,
          headers: jsonHeaders(),
          body: JSON.stringify({
            error:
              'כל הקבצים שנבחרו מוצפנים - לא ניתן למזג אותם להדפסה. הורידו אותם כ-ZIP ופתחו כל אחד בנפרד עם הסיסמה שלו.',
          }),
        };
      }
      const { buffer, failed } = await mergePdfs(mergeable);
      return {
        statusCode: 200,
        headers: jsonHeaders(),
        body: JSON.stringify({
          filename: 'חשבוניות-ממוזגות.pdf',
          mimeType: 'application/pdf',
          base64: buffer.toString('base64'),
          skipped: [...encryptedSkipped, ...failed],
        }),
      };
    }

    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'mode לא תקין' }) };
  } catch (err) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
