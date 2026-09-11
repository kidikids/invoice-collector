// ניהול גיליון "מעקב חשבוניות" - שתי לשוניות:
// "חשבוניות" - יומן כל חשבונית שהתגלתה (משמש גם למניעת כפילויות, וגם להשוואת סכומים בין חודשים)
// "ספקים"    - טבלה שאתם ממלאים: שולח/דומיין -> סיסמה ידועה לקבצים המוגנים שלו.
//              כל שורה כאן היא גם ספק שהמערכת תחפש עבורו באופן יזום בכל הרצה
//              (לפי from:<שולח/דומיין>), גם אם כותרת המייל שלו לא מכילה
//              את מילת החיפוש הרגילה - כדי לתפוס ספקים קבועים כמו חברות סלולר/אינטרנט.

const INVOICES_TAB = 'חשבוניות';
const VENDORS_TAB = 'ספקים';
const RULES_TAB = 'כללי חיפוש';

async function ensureSheetTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map((s) => s.properties.title);
  const requests = [];
  if (!existing.includes(INVOICES_TAB)) {
    requests.push({ addSheet: { properties: { title: INVOICES_TAB } } });
  }
  if (!existing.includes(VENDORS_TAB)) {
    requests.push({ addSheet: { properties: { title: VENDORS_TAB } } });
  }
  if (!existing.includes(RULES_TAB)) {
    requests.push({ addSheet: { properties: { title: RULES_TAB } } });
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${INVOICES_TAB}!A1:M1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        [
          'תאריך',
          'שולח',
          'שם קובץ',
          'סטטוס',
          'סיסמה',
          'קישור לדרייב',
          'Message ID',
          'סכום',
          'שינוי לעומת פעם קודמת',
          'Drive File ID',
          'קטגוריה',
          'סטטוס תשלום',
          'הערה',
        ],
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${VENDORS_TAB}!E1:E1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        [
          'טיפ: כל שורה כאן גם נחפשת אוטומטית בכל הרצה (from:) - גם אם כותרת המייל שונה',
        ],
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${VENDORS_TAB}!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['שולח / דומיין', 'סיסמה ידועה', 'הערות']] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${RULES_TAB}!A1:D1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['סוג (כלול/החרג)', 'שולח / דומיין', 'מילת מפתח בנושא', 'הערה']],
    },
  });
}

// מחזיר מיפוי של שולח/דומיין -> סיסמה, לפי מה שמולא בלשונית "ספקים"
async function getVendorPasswords(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${VENDORS_TAB}!A2:B1000`,
  });
  const map = {};
  (res.data.values || []).forEach((row) => {
    if (row[0]) map[row[0].trim().toLowerCase()] = (row[1] || '').trim();
  });
  return map;
}

async function appendInvoiceRow(sheets, spreadsheetId, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICES_TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// שולף את כל ה-Message ID-ים שכבר תועדו, כדי לא לעבד את אותה הודעה פעמיים
async function getLoggedMessageIds(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVOICES_TAB}!G2:G200000`,
  });
  return new Set((res.data.values || []).map((r) => r[0]).filter(Boolean));
}

// בונה מיפוי של "ספק" (כתובת המייל של השולח) -> הסכום והתאריך של החשבונית
// האחרונה הידועה שלו, כדי לאפשר השוואה בין חודשים וזיהוי עליות מחיר.
function extractVendorKey(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : from || '').trim().toLowerCase();
}

async function getVendorAmountHistory(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVOICES_TAB}!A2:H200000`,
  });
  const map = {};
  (res.data.values || []).forEach((row) => {
    const dateStr = row[0];
    const from = row[1];
    const amountStr = row[7];
    if (!from || !amountStr) return;
    const amount = parseFloat(String(amountStr).replace(/,/g, ''));
    if (Number.isNaN(amount)) return;
    const key = extractVendorKey(from);
    const date = new Date(dateStr);
    if (!map[key] || date > map[key].date) {
      map[key] = { amount, date };
    }
  });
  return map;
}

// שולף את כל שורות יומן החשבוניות כמו שהן (למסך "הדפסה והורדה לרו"ח" ולעריכת פרטים)
async function getAllInvoiceRows(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVOICES_TAB}!A2:M200000`,
  });
  return res.data.values || [];
}

// מעדכן קטגוריה/סטטוס תשלום/הערה לחשבונית קיימת (מזוהה לפי Message ID או
// Drive File ID) - משמש את מסך פרטי החשבונית בדשבורד. מחזיר false אם לא נמצאה שורה מתאימה.
async function updateInvoiceFields(sheets, spreadsheetId, { messageId, driveFileId, category, paymentStatus, note }) {
  const rows = await getAllInvoiceRows(sheets, spreadsheetId);
  const idx = rows.findIndex(
    (r) => (messageId && r[6] === messageId) || (driveFileId && r[9] === driveFileId)
  );
  if (idx === -1) return false;
  const rowNumber = idx + 2; // +2: הטווח מתחיל מ-A2, ומספור השורות בגיליון מתחיל מ-1
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${INVOICES_TAB}!K${rowNumber}:M${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[category || '', paymentStatus || '', note || '']] },
  });
  return true;
}

const RULE_TYPE_INCLUDE = 'כלול';
const RULE_TYPE_EXCLUDE = 'החרג';

// שולף את "כללי חיפוש" - רשימת כללי "כלול" (משיכה יזומה לפי שולח/נושא) ו"החרג"
// (התעלמות מהודעות, גם אם היו נתפסות בחיפוש הרגיל), שמנוהלים דרך מסך ההגדרות באפליקציה.
async function getSearchRules(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RULES_TAB}!A2:D1000`,
  });
  return (res.data.values || [])
    .map((row) => ({
      type: (row[0] || '').trim(),
      sender: (row[1] || '').trim(),
      subjectKeyword: (row[2] || '').trim(),
      note: (row[3] || '').trim(),
    }))
    .filter((r) => r.type && (r.sender || r.subjectKeyword));
}

// מחליף את כל רשימת כללי החיפוש בבת אחת (הדרך הפשוטה והבטוחה ביותר להוספה/מחיקה
// דרך מסך ההגדרות - במקום לעקוב אחרי מספרי שורות בגיליון).
async function setSearchRules(sheets, spreadsheetId, rules) {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${RULES_TAB}!A2:D1000` });
  const values = (rules || [])
    .filter((r) => r && r.type && (r.sender || r.subjectKeyword))
    .map((r) => [r.type, r.sender || '', r.subjectKeyword || '', r.note || '']);
  if (values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${RULES_TAB}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }
}

module.exports = {
  INVOICES_TAB,
  VENDORS_TAB,
  RULES_TAB,
  RULE_TYPE_INCLUDE,
  RULE_TYPE_EXCLUDE,
  ensureSheetTabs,
  getVendorPasswords,
  appendInvoiceRow,
  getLoggedMessageIds,
  getVendorAmountHistory,
  extractVendorKey,
  getAllInvoiceRows,
  updateInvoiceFields,
  getSearchRules,
  setSearchRules,
};
