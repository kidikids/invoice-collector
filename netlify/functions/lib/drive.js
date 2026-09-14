const { Readable } = require('stream');
const { withRetry } = require('./apiRetry');

// מוצא תיקייה לפי שם (ותיקיית אב אופציונלית), או יוצר אותה אם לא קיימת.
// כשמעבירים cache (Map) משותף להרצה שלמה, תוצאת החיפוש/היצירה נשמרת בו -
// כך שכמה חשבוניות מאותו חודש באותה הרצה לא גורמות לחיפוש/יצירה חוזרים
// של אותה תיקיית שנה/חודש בדרייב (חוסך קריאות API וזמן ריצה).
async function getOrCreateFolder(drive, name, parentId, cache) {
  const cacheKey = `${parentId || 'root'}::${name}`;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

  const safeName = name.replace(/'/g, "\\'");
  let q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const res = await withRetry(() => drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' }));
  let id;
  if (res.data.files && res.data.files.length > 0) {
    id = res.data.files[0].id;
  } else {
    const createRes = await withRetry(() =>
      drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : undefined,
        },
        fields: 'id',
      })
    );
    id = createRes.data.id;
  }
  if (cache) cache.set(cacheKey, id);
  return id;
}

// מעלה חשבונית לתיקייה חשבוניות/<שנה>/<חודש>, יוצר את התיקיות במידת הצורך.
async function uploadInvoice(drive, { rootFolderId, year, month, filename, buffer, mimeType, folderCache }) {
  const rootId = rootFolderId || (await getOrCreateFolder(drive, 'חשבוניות', undefined, folderCache));
  const yearId = await getOrCreateFolder(drive, String(year), rootId, folderCache);
  const monthId = await getOrCreateFolder(drive, String(month).padStart(2, '0'), yearId, folderCache);

  const res = await withRetry(() =>
    drive.files.create({
      requestBody: { name: filename, parents: [monthId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    })
  );
  return res.data;
}

module.exports = { getOrCreateFolder, uploadInvoice };
