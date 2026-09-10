const { google } = require('googleapis');
const https = require('https');
const { getOAuthClient } = require('./googleAuth');
const {
  searchInvoiceMessages,
  getMessage,
  findHeader,
  extractAttachmentsAndLinks,
  getAttachmentData,
} = require('./gmail');
const { uploadInvoice } = require('./drive');
const {
  ensureSheetTabs,
  getVendorPasswords,
  appendInvoiceRow,
  getLoggedMessageIds,
} = require('./sheets');
const { isPdfEncrypted } = require('./pdfCheck');

const DEFAULT_QUERY = 'subject:חשבונית newer_than:60d';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // עוקב אחרי הפניה (redirect) אחת ברמת https בלבד - מספיק לרוב קישורי החשבוניות
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchUrl(res.headers.location));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      })
      .on('error', reject);
  });
}

function statusLabel(encrypted, knownPassword, viaLink) {
  const suffix = viaLink ? ' (מקישור בהודעה)' : '';
  if (!encrypted) return 'הורד בהצלחה' + suffix;
  return (knownPassword ? 'מוצפן - סיסמה ידועה' : 'מוצפן - נדרשת סיסמה (הוסיפו בלשונית "ספקים")') + suffix;
}

// הלב של המערכת: מחפש הודעות חשבונית ב-Gmail, מוריד PDF (מצורף או מקישור),
// מזהה קבצים מוצפנים (בלי לפצח סיסמאות), ומתעד/מעלה לדרייב + לגיליון.
// dryRun=true מריץ את כל הלוגיקה אך לא כותב/מעלה כלום - לבדיקה בטוחה.
async function runSync({ dryRun = false } = {}) {
  const results = {
    dryRun,
    matched: 0,
    downloaded: 0,
    encrypted: 0,
    needsReview: 0,
    skippedAlready: 0,
    items: [],
  };

  const auth = getOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.INVOICE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error('חסר משתנה סביבה INVOICE_SHEET_ID (ה-ID של גיליון "מעקב חשבוניות"). ראו README.');
  }

await ensureSheetTabs(sheets, spreadsheetId);
  const vendorPasswords = await getVendorPasswords(sheets, spreadsheetId);
  const alreadyLogged = dryRun ? new Set() : await getLoggedMessageIds(sheets, spreadsheetId);

  const query = process.env.GMAIL_SEARCH_QUERY || DEFAULT_QUERY;
  const messages = await searchInvoiceMessages(gmail, { query, maxResults: 100 });
  results.matched = messages.length;

  for (const m of messages) {
    if (alreadyLogged.has(m.id)) {
      results.skippedAlready++;
      continue;
    }

    const full = await getMessage(gmail, m.id);
    const headers = full.payload.headers || [];
    const from = findHeader(headers, 'From');
    const dateHeader = findHeader(headers, 'Date');
    const date = dateHeader ? new Date(dateHeader) : new Date(Number(full.internalDate));
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    const domainMatch = (from.match(/@([\w.-]+)/) || [])[1] || '';
    const knownPassword =
      vendorPasswords[from.trim().toLowerCase()] || vendorPasswords[domainMatch.toLowerCase()] || '';

    const { attachments, links } = extractAttachmentsAndLinks(full.payload);
    let handled = false;

    // מקרה 1: יש קובץ PDF מצורף ישירות להודעה
    for (const att of attachments) {
      handled = true;
      const buffer = await getAttachmentData(gmail, m.id, att.attachmentId);
      const encrypted = isPdfEncrypted(buffer);
      let driveLink = '';
      const filename = `${date.toISOString().slice(0, 10)}_${att.filename}`;

      if (!dryRun) {
        const uploaded = await uploadInvoice(drive, {
          rootFolderId: process.env.DRIVE_ROOT_FOLDER_ID,
          year,
          month,
          filename,
          buffer,
          mimeType: 'application/pdf',
        });
        driveLink = uploaded.webViewLink;
        await appendInvoiceRow(sheets, spreadsheetId, [
          date.toISOString().slice(0, 10),
          from,
          filename,
          statusLabel(encrypted, knownPassword, false),
          knownPassword,
          driveLink,
          m.id,
        ]);
      }

      if (encrypted) results.encrypted++;
      else results.downloaded++;
      results.items.push({ from, filename, encrypted, hasKnownPassword: !!knownPassword, driveLink, mode: 'attachment' });
    }

    // מקרה 2: אין מצורף, אבל יש קישור בגוף ההודעה שנראה כמו קישור להורדת חשבונית
    if (!handled && links.length) {
      const link = links[0];
      try {
        const resp = await fetchUrl(link.url);
        const contentType = (resp.headers['content-type'] || '').toLowerCase();
           const looksLikePdf = resp.body && resp.body.slice(0, 4).toString('latin1') === '%PDF';

   if (contentType.includes('pdf') || looksLikePdf) {          handled = true;
          const buffer = resp.body;
          const encrypted = isPdfEncrypted(buffer);
          const filename = `${date.toISOString().slice(0, 10)}_invoice.pdf`;
          let driveLink = '';

          if (!dryRun) {
            const uploaded = await uploadInvoice(drive, {
              rootFolderId: process.env.DRIVE_ROOT_FOLDER_ID,
              year,
              month,
              filename,
              buffer,
              mimeType: 'application/pdf',
            });
            driveLink = uploaded.webViewLink;
            await appendInvoiceRow(sheets, spreadsheetId, [
              date.toISOString().slice(0, 10),
              from,
              filename,
              statusLabel(encrypted, knownPassword, true),
              knownPassword,
              driveLink,
              m.id,
            ]);
          }

          if (encrypted) results.encrypted++;
          else results.downloaded++;
          results.items.push({ from, filename, encrypted, hasKnownPassword: !!knownPassword, driveLink, mode: 'link' });
        } else {
          // הקישור מוביל לדף אינטרנט ולא לקובץ ישירות - שלב 2 שדורש דפדפן אוטומטי, לא נתמך כרגע
          handled = true;
          results.needsReview++;
          if (!dryRun) {
            await appendInvoiceRow(sheets, spreadsheetId, [
              date.toISOString().slice(0, 10),
              from,
              '(קישור להורדה ידנית)',
              'דורש הורדה ידנית - הקישור מוביל לדף ולא ישירות ל-PDF',
              knownPassword,
              link.url,
              m.id,
            ]);
          }
          results.items.push({ from, note: 'קישור דורש טיפול ידני (מוביל לדף, לא לקובץ)', link: link.url, mode: 'link-manual' });
        }
      } catch (e) {
        handled = true;
        results.needsReview++;
        results.items.push({ from, note: 'שגיאה בגישה לקישור: ' + e.message, link: link.url, mode: 'link-error' });
      }
    }

    if (!handled) {
      results.needsReview++;
      results.items.push({ from, note: 'לא נמצא קובץ מצורף או קישור רלוונטי בהודעה - דורש בדיקה ידנית', mode: 'none' });
    }
  }

  return results;
}

module.exports = { runSync, DEFAULT_QUERY };
