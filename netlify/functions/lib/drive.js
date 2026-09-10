const { Readable } = require('stream');

// מוצא תיקייה לפי שם (ותיקיית אב אופציונלית), או יוצר אותה אם לא קיימת.
async function getOrCreateFolder(drive, name, parentId) {
  const safeName = name.replace(/'/g, "\\'");
  let q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const res = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;

  const createRes = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });
  return createRes.data.id;
}

// מעלה חשבונית לתיקייה חשבוניות/<שנה>/<חודש>, יוצר את התיקיות במידת הצורך.
async function uploadInvoice(drive, { rootFolderId, year, month, filename, buffer, mimeType }) {
  const rootId = rootFolderId || (await getOrCreateFolder(drive, 'חשבוניות'));
  const yearId = await getOrCreateFolder(drive, String(year), rootId);
  const monthId = await getOrCreateFolder(drive, String(month).padStart(2, '0'), yearId);

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [monthId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });
  return res.data;
}

module.exports = { getOrCreateFolder, uploadInvoice };
