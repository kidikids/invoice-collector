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
  getVendorAmountHistory,
  extractVendorKey,
  getSearchRules,
  RULE_TYPE_INCLUDE,
  RULE_TYPE_EXCLUDE,
} = require('./sheets');
const { isPdfEncrypted } = require('./pdfCheck');
const { extractAmountFromPdf } = require('./amountExtract');

const DEFAULT_DAYS_BACK = 60;
// ניתן לצמצם/להרחיב את טווח החיפוש ההיסטורי (למשל למשיכה לאחור חד-פעמית של ספק חדש) -
// הגבלה שמרנית כדי לא לחרוג ממגבלת הזמן של פונקציית Netlify בהרצה אחת.
const MAX_DAYS_BACK = 730;

function buildDefaultQuery(daysBack) {
  return `subject:חשבונית newer_than:${daysBack}d`;
}

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

// כשמישהו משתף חשבונית מוואטסאפ (או ממקור אחר) לעצמו ב-Gmail, כתובת "From"
// היא כתובת המשתמש עצמו ולא הספק האמיתי - זה יקלקל את קיבוץ הספקים והשוואת
// הסכומים. במקרה כזה, שולפים את שם הספק מתוך שורת הנושא (למשל "חשבונית - בזק"
// הופך ל"בזק") כדי שהמעקב וההתראות ימשיכו לעבוד נכון גם על חשבוניות כאלה.
function deriveVendorNameFromSubject(subject) {
  if (!subject) return '';
  const cleaned = String(subject)
    .replace(/חשבונית/gi, '')
    .replace(/invoice/gi, '')
    .replace(/receipt/gi, '')
    .replace(/[-:|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

// בודק אם הודעה תואמת אחד מכללי "החרג" שהוגדרו במסך ההגדרות - אם הוגדרו גם
// שולח וגם מילת מפתח באותו כלל, שניהם צריכים להתאים; אם הוגדר רק אחד מהם, מספיק שהוא יתאים.
function matchesExcludeRule(from, subject, excludeRules) {
  const fromLower = String(from || '').toLowerCase();
  const subjectLower = String(subject || '').toLowerCase();
  return excludeRules.some((r) => {
    const senderMatch = r.sender ? fromLower.includes(r.sender.toLowerCase()) : null;
    const subjectMatch = r.subjectKeyword ? subjectLower.includes(r.subjectKeyword.toLowerCase()) : null;
    if (senderMatch !== null && subjectMatch !== null) return senderMatch && subjectMatch;
    if (senderMatch !== null) return senderMatch;
    if (subjectMatch !== null) return subjectMatch;
    return false;
  });
}

function statusLabel(encrypted, knownPassword, viaLink) {
  const suffix = viaLink ? ' (מקישור בהודעה)' : '';
  if (!encrypted) return 'הורד בהצלחה' + suffix;
  return (knownPassword ? 'מוצפן - סיסמה ידועה' : 'מוצפן - נדרשת סיסמה (הוסיפו בלשונית "ספקים")') + suffix;
}

// משווה סכום חדש לסכום הידוע הקודם של אותו ספק, ומחזיר תווית טקסטואלית
// לעמודת "שינוי" בגיליון, וכן אובייקט התראה אם מדובר בעלייה.
function compareAmount({ amount, from, filename, driveLink, mode, amountHistory }) {
  const vendorKey = extractVendorKey(from);
  const prev = amountHistory[vendorKey];
  let changeLabel = '';
  let alert = null;

  if (prev && prev.amount > 0 && amount !== null) {
    const diff = amount - prev.amount;
    const pct = (diff / prev.amount) * 100;
    if (Math.abs(diff) >= 0.01) {
      const direction = diff > 0 ? 'עלייה' : 'ירידה';
      changeLabel = `${direction}: ${prev.amount.toFixed(2)} ₪ ← ${amount.toFixed(2)} ₪ (${diff > 0 ? '+' : ''}${pct.toFixed(1)}%)`;
      if (diff > 0) {
        alert = { from, filename, previousAmount: prev.amount, newAmount: amount, diff, pct, driveLink, mode };
      }
    } else {
      changeLabel = 'ללא שינוי';
    }
  }

  if (amount !== null) {
    amountHistory[vendorKey] = { amount, date: new Date() };
  }

  return { changeLabel, alert };
}

// הלב של המערכת: מחפש הודעות חשבונית ב-Gmail, מוריד PDF (מצורף או מקישור),
// מזהה קבצים מוצפנים (בלי לפצח סיסמאות), מנסה לזהות את סכום החיוב ולהשוות
// לחודש קודם אצל אותו ספק, ומתעד/מעלה לדרייב + לגיליון.
// dryRun=true מריץ את כל הלוגיקה אך לא כותב/מעלה כלום - לבדיקה בטוחה, כולל תצוגה מקדימה של התראות.
async function runSync({ dryRun = false, daysBack = DEFAULT_DAYS_BACK } = {}) {
  const safeDaysBack = Math.min(Math.max(Number(daysBack) || DEFAULT_DAYS_BACK, 1), MAX_DAYS_BACK);
  const results = {
    dryRun,
    daysBack: safeDaysBack,
    matched: 0,
    downloaded: 0,
    encrypted: 0,
    needsReview: 0,
    skippedAlready: 0,
    priceIncreases: 0,
    excluded: 0,
    items: [],
    alerts: [],
  };

  const auth = getOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.INVOICE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error('חסר משתנה סביבה INVOICE_SHEET_ID (ה-ID של גיליון "מעקב חשבוניות"). ראו README.');
  }

  // תמיד מוודאים שהלשוניות/כותרות קיימות - גם בבדיקה יבשה, כדי שקריאות
  // מהגיליון (סיסמאות, היסטוריית סכומים) לא ייכשלו על גיליון ריק.
  await ensureSheetTabs(sheets, spreadsheetId);
  const vendorPasswords = await getVendorPasswords(sheets, spreadsheetId);
  const alreadyLogged = dryRun ? new Set() : await getLoggedMessageIds(sheets, spreadsheetId);
  const amountHistory = await getVendorAmountHistory(sheets, spreadsheetId);

  // כתובת המייל של החשבון המחובר עצמו - כדי לזהות הודעות ש"שותפו לעצמי"
  // (למשל חשבונית שהועברה מוואטסאפ ל-Gmail), ולטפל בהן אחרת (ראו למעלה).
  let selfEmail = '';
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    selfEmail = (profile.data.emailAddress || '').trim().toLowerCase();
  } catch (e) {
    selfEmail = '';
  }

  const query = process.env.GMAIL_SEARCH_QUERY || buildDefaultQuery(safeDaysBack);
  const baseMessages = await searchInvoiceMessages(gmail, { query, maxResults: 100 });

  // בנוסף לחיפוש הכללי לפי מילת מפתח בכותרת, מחפשים גם באופן יזום לפי כל
  // שולח/דומיין שמולא בלשונית "ספקים" - כך ספק שמוכר (למשל בזק) יימצא בכל
  // חודש גם אם כותרת המייל שלו לא מכילה את המילה "חשבונית".
  const messages = [...baseMessages];
  const seenIds = new Set(baseMessages.map((m) => m.id));
  const vendorKeys = Object.keys(vendorPasswords).filter(Boolean);
  for (const key of vendorKeys) {
    const vendorMessages = await searchInvoiceMessages(gmail, {
      query: `from:${key} newer_than:${safeDaysBack}d`,
      maxResults: 20,
    });
    for (const vm of vendorMessages) {
      if (!seenIds.has(vm.id)) {
        seenIds.add(vm.id);
        messages.push(vm);
      }
    }
  }

  // כללי חיפוש נוספים שהוגדרו במסך "הגדרות ועזרה" באפליקציה - כלל "כלול" עם
  // שולח ו/או מילת מפתח בנושא מוסיף חיפוש יזום נוסף; כלל "החרג" מסונן בהמשך.
  const searchRules = await getSearchRules(sheets, spreadsheetId);
  const includeRules = searchRules.filter((r) => r.type === RULE_TYPE_INCLUDE);
  const excludeRules = searchRules.filter((r) => r.type === RULE_TYPE_EXCLUDE);

  for (const rule of includeRules) {
    const parts = [];
    if (rule.sender) parts.push(`from:${rule.sender}`);
    if (rule.subjectKeyword) parts.push(`subject:${rule.subjectKeyword}`);
    if (!parts.length) continue;
    const ruleMessages = await searchInvoiceMessages(gmail, {
      query: `${parts.join(' ')} newer_than:${safeDaysBack}d`,
      maxResults: 20,
    });
    for (const rm of ruleMessages) {
      if (!seenIds.has(rm.id)) {
        seenIds.add(rm.id);
        messages.push(rm);
      }
    }
  }

  results.matched = messages.length;

  for (const m of messages) {
    if (alreadyLogged.has(m.id)) {
      results.skippedAlready++;
      continue;
    }

    const full = await getMessage(gmail, m.id);
    const headers = full.payload.headers || [];
    const from = findHeader(headers, 'From');
    const subject = findHeader(headers, 'Subject');
    const dateHeader = findHeader(headers, 'Date');
    const date = dateHeader ? new Date(dateHeader) : new Date(Number(full.internalDate));
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    // הודעה ש"שותפה לעצמי" (וואטסאפ/אחר) - נציג את שם הספק מתוך הנושא במקום
    // את הכתובת של המשתמש עצמו, כדי שקיבוץ הספקים והשוואת הסכומים יעבדו נכון.
    const fromEmailMatch = (from.match(/<([^>]+)>/) || [])[1] || from;
    const isSelfSent = !!selfEmail && fromEmailMatch.trim().toLowerCase() === selfEmail;
    const effectiveFrom = isSelfSent
      ? deriveVendorNameFromSubject(subject) || 'שיתוף עצמי (וואטסאפ/אחר)'
      : from;

    // כלל "החרג" שהוגדר במסך ההגדרות - מדלגים על ההודעה כליל, עוד לפני שמורידים
    // אותה או מתעדים אותה בכלל.
    if (matchesExcludeRule(from, subject, excludeRules)) {
      results.excluded++;
      continue;
    }

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

      const amount = encrypted ? null : await extractAmountFromPdf(buffer);
      const { changeLabel, alert } = compareAmount({
        amount,
        from: effectiveFrom,
        filename,
        driveLink,
        mode: 'attachment',
        amountHistory,
      });

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
        if (alert) alert.driveLink = driveLink;
        await appendInvoiceRow(sheets, spreadsheetId, [
          date.toISOString().slice(0, 10),
          effectiveFrom,
          filename,
          statusLabel(encrypted, knownPassword, false),
          knownPassword,
          driveLink,
          m.id,
          amount !== null ? amount.toFixed(2) : '',
          changeLabel,
          uploaded.id || '',
          '',
          'לא שולם',
          '',
        ]);
      }

      if (encrypted) results.encrypted++;
      else results.downloaded++;
      if (alert) {
        results.priceIncreases++;
        results.alerts.push(alert);
      }
      results.items.push({
        from: effectiveFrom,
        filename,
        encrypted,
        hasKnownPassword: !!knownPassword,
        driveLink,
        mode: 'attachment',
        amount,
        changeLabel,
      });
    }

    // מקרה 2: אין מצורף, אבל יש קישור בגוף ההודעה שנראה כמו קישור להורדת חשבונית
    if (!handled && links.length) {
      const link = links[0];
      try {
        const resp = await fetchUrl(link.url);
        const contentType = (resp.headers['content-type'] || '').toLowerCase();
        const looksLikePdf = resp.body && resp.body.slice(0, 4).toString('latin1') === '%PDF';

        if (contentType.includes('pdf') || looksLikePdf) {
          handled = true;
          const buffer = resp.body;
          const encrypted = isPdfEncrypted(buffer);
          const filename = `${date.toISOString().slice(0, 10)}_invoice.pdf`;
          let driveLink = '';

          const amount = encrypted ? null : await extractAmountFromPdf(buffer);
          const { changeLabel, alert } = compareAmount({
            amount,
            from: effectiveFrom,
            filename,
            driveLink,
            mode: 'link',
            amountHistory,
          });

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
            if (alert) alert.driveLink = driveLink;
            await appendInvoiceRow(sheets, spreadsheetId, [
              date.toISOString().slice(0, 10),
              effectiveFrom,
              filename,
              statusLabel(encrypted, knownPassword, true),
              knownPassword,
              driveLink,
              m.id,
              amount !== null ? amount.toFixed(2) : '',
              changeLabel,
              uploaded.id || '',
              '',
              'לא שולם',
              '',
            ]);
          }

          if (encrypted) results.encrypted++;
          else results.downloaded++;
          if (alert) {
            results.priceIncreases++;
            results.alerts.push(alert);
          }
          results.items.push({
            from: effectiveFrom,
            filename,
            encrypted,
            hasKnownPassword: !!knownPassword,
            driveLink,
            mode: 'link',
            amount,
            changeLabel,
          });
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
              '',
              '',
              '',
              '',
              '',
              '',
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
