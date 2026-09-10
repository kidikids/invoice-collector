// חילוץ טקסט מקובץ PDF (לא מוצפן) וניסיון לזהות את סכום החיוב הכולל בחשבונית.
// זהו זיהוי היוריסטי מבוסס מילות מפתח נפוצות בעברית ובאנגלית - הוא לא מושלם,
// אבל עובד טוב ברוב החשבוניות הסטנדרטיות. כשלא מזוהה סכום, המערכת פשוט לא
// תשווה/תתריע עבור אותה חשבונית - שאר התהליך (הורדה, ארגון בדרייב) לא נפגע.

let pdfParse;
try {
  // eslint-disable-next-line global-require
  pdfParse = require('pdf-parse');
} catch (e) {
  pdfParse = null;
}

const TOTAL_KEYWORDS = [
  'סה"כ לתשלום',
  'סך הכל לתשלום',
  'סכום לתשלום',
  'סה"כ כולל מע"מ',
  'סה"כ לחיוב',
  'סכום לחיוב',
  'total amount due',
  'amount due',
  'grand total',
  'total due',
  'לתשלום',
  'total',
  'סה"כ',
];

const NUMBER_NEAR = /(?:₪|ils|nis)?\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:₪|ש"ח|שקל|ils|nis)?/i;

function parseNumber(str) {
  const n = parseFloat(String(str).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

// מחפש בטקסט חופשי את סכום החיוב הכולל
function extractAmountFromText(text) {
  if (!text) return null;
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lower = clean.toLowerCase();

  // עדיפות למילות מפתח ספציפיות, ולהופעה האחרונה שלהן בטקסט
  // (הסכום הסופי בדרך כלל מופיע בסוף החשבונית, אחרי פירוט השורות)
  for (const kw of TOTAL_KEYWORDS) {
    const idx = lower.lastIndexOf(kw.toLowerCase());
    if (idx === -1) continue;
    const windowText = clean.slice(idx + kw.length, idx + kw.length + 40);
    const match = windowText.match(NUMBER_NEAR);
    if (match && match[1]) {
      const n = parseNumber(match[1]);
      if (n !== null && n > 0) return n;
    }
  }

  // גיבוי: איסוף כל הסכומים המסומנים בסימן מטבע בטקסט, ובחירת הגדול ביותר
  const currencyMatches = [...clean.matchAll(/([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:₪|ש"ח)/g)];
  if (currencyMatches.length) {
    const nums = currencyMatches.map((m) => parseNumber(m[1])).filter((n) => n !== null && n > 0);
    if (nums.length) return Math.max(...nums);
  }

  return null;
}

async function extractAmountFromPdf(buffer) {
  if (!pdfParse) return null;
  try {
    const data = await pdfParse(buffer);
    return extractAmountFromText(data.text);
  } catch (e) {
    return null;
  }
}

module.exports = { extractAmountFromPdf, extractAmountFromText };
