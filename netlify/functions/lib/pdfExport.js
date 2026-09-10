// יצירת ZIP ומיזוג PDF-ים, לצורך הורדה/הדפסה מרוכזת של חשבוניות (למשל לשליחה לרו"ח).
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');

async function buildZip(files) {
  const zip = new JSZip();
  const usedNames = new Set();
  files.forEach(({ filename, buffer }) => {
    let name = filename || 'invoice.pdf';
    let i = 1;
    while (usedNames.has(name)) {
      name = (filename || 'invoice.pdf').replace(/(\.pdf)?$/i, `_${i}$1`);
      i++;
    }
    usedNames.add(name);
    zip.file(name, buffer);
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ממזג קבצי PDF (לא מוצפנים) לקובץ אחד. קבצים שנכשלים בטעינה (למשל בכל זאת
// מוצפנים, או פגומים) מדולגים ומוחזרים ברשימת failed כדי להציג למשתמש.
async function mergePdfs(files) {
  const merged = await PDFDocument.create();
  const failed = [];
  for (const f of files) {
    try {
      const src = await PDFDocument.load(f.buffer);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch (e) {
      failed.push(f.filename);
    }
  }
  const bytes = await merged.save();
  return { buffer: Buffer.from(bytes), failed };
}

module.exports = { buildZip, mergePdfs };
