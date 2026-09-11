// פונקציות עזר לחיפוש הודעות ב-Gmail וחילוץ קבצים/קישורים מתוכן.
// כל קריאה בפועל ל-API עטופה ב-withRetry, כדי להתמודד לבד עם שגיאות מכסה
// זמניות ("Quota exceeded... Units per minute per user") שקופצות כשסורקים
// הרבה הודעות ברצף - במקום להיכשל מיד באמצע סריקה.

const { withRetry } = require('./apiRetry');

async function searchInvoiceMessages(gmail, { query, maxResults = 100 }) {
  const res = await withRetry(() => gmail.users.messages.list({ userId: 'me', q: query, maxResults }));
  return res.data.messages || [];
}

async function getMessage(gmail, id) {
  const res = await withRetry(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
  return res.data;
}

// גרסה קלה יותר - שולפת רק כותרות נבחרות (למשל From/Subject) בלי את כל גוף
// ההודעה והמצורפים. משמשת את "גילוי ספקים חדשים" שצריך לעבור על הרבה הודעות
// רק כדי לדעת מי השולח, ולא רוצה להעמיס מכסה בכינם.
async function getMessageMeta(gmail, id, headerNames) {
  const res = await withRetry(() =>
    gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: headerNames })
  );
  return res.data;
}

function findHeader(headers, name) {
  const h = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// עובר על מבנה ההודעה (יכול להיות מקונן עם parts רבים) ומחלץ:
// - קבצי PDF מצורפים
// - קישורים בגוף ה-HTML שנראים כמו קישורי הורדת חשבונית
function extractAttachmentsAndLinks(payload) {
  const attachments = [];
  let htmlBody = '';

  function walk(part) {
    if (!part) return;
    if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body) {
      attachments.push({
        filename: part.filename,
        attachmentId: part.body.attachmentId,
        mimeType: part.mimeType,
      });
    }
    if (part.mimeType === 'text/html' && part.body && part.body.data) {
      htmlBody += Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);

  const links = [];
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRegex.exec(htmlBody))) {
    const url = m[1];
    if (!/^https?:\/\//i.test(url)) continue; // מתעלם מקישורי mailto: וכו', שאינם קישורי הורדה
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const looksRelevant =
      /הורד|חשבונית|קבלה|invoice|receipt|download|לצפייה|טופס/i.test(text) ||
      /invoice|receipt|document|billing/i.test(url);
    if (looksRelevant) links.push({ url, text });
  }
  return { attachments, links };
}

async function getAttachmentData(gmail, messageId, attachmentId) {
  const res = await withRetry(() =>
    gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    })
  );
  return Buffer.from(res.data.data, 'base64');
}

module.exports = {
  searchInvoiceMessages,
  getMessage,
  getMessageMeta,
  findHeader,
  extractAttachmentsAndLinks,
  getAttachmentData,
};
