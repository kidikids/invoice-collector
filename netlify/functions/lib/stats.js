// חישוב סטטיסטיקות/הוצאות מתוך יומן החשבוניות שכבר תועד בגיליון (לשונית "חשבוניות").
// לא נוגע ב-Gmail/Drive בכלל - קורא רק את מה שכבר נשמר, ולכן זול וזמין תמיד.

const { extractVendorKey } = require('./sheets');

function vendorDisplayName(from) {
  const s = String(from || '').trim();
  const m = s.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  if (m && m[1].trim()) return m[1].trim();
  const emailOnly = s.match(/^([^<>@\s]+@[^<>\s]+)$/);
  if (emailOnly) return emailOnly[1];
  return s || 'לא ידוע';
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
  return `${names[Number(m) - 1]} ${y}`;
}

function fmtIls(n) {
  return Math.round(n || 0).toLocaleString('he-IL');
}

function buildStats(rows) {
  const now = new Date();
  const vendorTotals = {}; // key -> { name, total, count }
  const monthTotals = {}; // 'YYYY-MM' -> total
  const categoryTotals = {}; // שם קטגוריה -> { total, count }
  let totalAllTime = 0;
  let invoiceCount = 0;
  let amountCount = 0;
  let encryptedPendingCount = 0;
  let unpaidTotal = 0;
  let unpaidCount = 0;
  let maxInvoice = null; // {amount, vendor, date, driveLink}
  const priceIncreaseRows = [];

  rows.forEach((row) => {
    const dateStr = row[0];
    const from = row[1] || '';
    const status = row[3] || '';
    const amountStr = row[7];
    const changeLabel = row[8] || '';
    const driveLink = row[5] || '';
    const category = (row[10] || '').trim() || 'ללא קטגוריה';
    const paymentStatus = (row[11] || '').trim();

    if (!dateStr) return;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return;

    invoiceCount++;
    if (status.includes('נדרשת סיסמה')) encryptedPendingCount++;

    const amount = amountStr ? parseFloat(String(amountStr).replace(/,/g, '')) : null;
    if (amount !== null && !Number.isNaN(amount)) {
      totalAllTime += amount;
      amountCount += 1;
      if (!maxInvoice || amount > maxInvoice.amount) {
        maxInvoice = { amount, vendor: vendorDisplayName(from), date: dateStr, driveLink };
      }
      const key = extractVendorKey(from);
      if (!vendorTotals[key]) vendorTotals[key] = { name: vendorDisplayName(from), total: 0, count: 0 };
      vendorTotals[key].total += amount;
      vendorTotals[key].count += 1;
      vendorTotals[key].name = vendorDisplayName(from); // תמיד עדכני לפי הרשומה האחרונה שנקראה

      const mk = monthKey(date);
      monthTotals[mk] = (monthTotals[mk] || 0) + amount;

      if (!categoryTotals[category]) categoryTotals[category] = { total: 0, count: 0 };
      categoryTotals[category].total += amount;
      categoryTotals[category].count += 1;

      if (paymentStatus === 'לא שולם' || !paymentStatus) {
        unpaidTotal += amount;
        unpaidCount += 1;
      }
    }

    if (changeLabel.startsWith('עלייה')) {
      priceIncreaseRows.push({ date: dateStr, vendor: vendorDisplayName(from), changeLabel, driveLink });
    }
  });

  // 6 החודשים האחרונים, כולל חודשים ללא הוצאה (מוצגים כ-0)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    months.push({ key, label: monthLabel(key), total: Math.round((monthTotals[key] || 0) * 100) / 100 });
  }

  const thisMonthKey = monthKey(now);
  const lastMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const thisMonthTotal = Math.round((monthTotals[thisMonthKey] || 0) * 100) / 100;
  const lastMonthTotal = Math.round((monthTotals[lastMonthKey] || 0) * 100) / 100;
  const monthOverMonthPct = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : null;

  const topVendors = Object.values(vendorTotals)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((v) => ({ name: v.name, total: Math.round(v.total * 100) / 100, count: v.count }));

  const recentIncreases = priceIncreaseRows
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 6);

  const categories = Object.entries(categoryTotals)
    .map(([name, v]) => ({ name, total: Math.round(v.total * 100) / 100, count: v.count }))
    .sort((a, b) => b.total - a.total);

  const uncategorized = categoryTotals['ללא קטגוריה'] || { total: 0, count: 0 };
  const avgInvoiceAmount = amountCount ? totalAllTime / amountCount : 0;
  const topVendorSharePct =
    topVendors.length && totalAllTime > 0 ? (topVendors[0].total / totalAllTime) * 100 : null;

  // --- תובנות אוטומטיות: ניתוח חוקים פשוט (לא AI) על הנתונים שכבר תועדו,
  // כדי להצביע על דברים ששווה לבדוק - ריכוזיות ספק/קטגוריה, חשבוניות לא
  // מסווגות, עליות מחיר, קפיצה חודשית וכו'.
  const insights = [];

  if (categories.length && totalAllTime > 0) {
    const top = categories[0];
    const pct = (top.total / totalAllTime) * 100;
    if (top.name !== 'ללא קטגוריה' && pct >= 30) {
      insights.push({
        type: 'category-concentration',
        text: `הקטגוריה "${top.name}" מהווה ${pct.toFixed(0)}% מכלל ההוצאות שתועדו (${fmtIls(top.total)} ₪) - כדאי לבדוק אם יש מקום לצמצם או למקד מו"מ מול הספקים שם.`,
      });
    }
  }

  if (uncategorized.count > 0) {
    insights.push({
      type: 'uncategorized',
      text: `${uncategorized.count} חשבוניות (${fmtIls(uncategorized.total)} ₪) עדיין ללא קטגוריה - סיווג שלהן דרך מסך פרטי החשבונית ייתן תמונה מדויקת יותר של ההוצאות.`,
    });
  }

  if (unpaidCount > 0) {
    insights.push({
      type: 'unpaid',
      text: `יש ${unpaidCount} חשבוניות בסך ${fmtIls(unpaidTotal)} ₪ שמסומנות "לא שולם" - כדאי לוודא שהסטטוס עדכני.`,
    });
  }

  if (priceIncreaseRows.length > 0) {
    insights.push({
      type: 'price-increase',
      text: `זוהו ${priceIncreaseRows.length} עליות מחיר לאחרונה - שווה לבדוק מול הספקים אם יש הצדקה לעלייה.`,
    });
  }

  if (topVendorSharePct !== null && topVendorSharePct >= 25) {
    insights.push({
      type: 'vendor-concentration',
      text: `הספק "${topVendors[0].name}" לבדו מהווה ${topVendorSharePct.toFixed(0)}% מסך ההוצאות שתועדו - תלות גבוהה בספק בודד.`,
    });
  }

  if (monthOverMonthPct !== null && monthOverMonthPct >= 15) {
    insights.push({
      type: 'month-jump',
      text: `ההוצאה החודש עלתה ב-${monthOverMonthPct.toFixed(0)}% לעומת החודש הקודם - כדאי לבדוק אם מדובר בהוצאה חד-פעמית או במגמה מתמשכת.`,
    });
  }

  if (encryptedPendingCount > 0) {
    insights.push({
      type: 'encrypted-pending',
      text: `${encryptedPendingCount} חשבוניות ממתינות לסיסמה כדי שנוכל לזהות את הסכום שלהן - השלימו את הסיסמה בלשונית "ספקים" בגיליון.`,
    });
  }

  return {
    invoiceCount,
    vendorCount: Object.keys(vendorTotals).length,
    encryptedPendingCount,
    totalAllTime: Math.round(totalAllTime * 100) / 100,
    thisMonthTotal,
    lastMonthTotal,
    monthOverMonthPct,
    months,
    topVendors,
    topVendorSharePct,
    priceIncreaseCount: priceIncreaseRows.length,
    recentIncreases,
    categories,
    unpaidTotal: Math.round(unpaidTotal * 100) / 100,
    unpaidCount,
    avgInvoiceAmount: Math.round(avgInvoiceAmount * 100) / 100,
    maxInvoice,
    uncategorizedCount: uncategorized.count,
    uncategorizedTotal: Math.round(uncategorized.total * 100) / 100,
    insights,
  };
}

module.exports = { buildStats, vendorDisplayName };
