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

function buildStats(rows) {
  const now = new Date();
  const vendorTotals = {}; // key -> { name, total, count }
  const monthTotals = {}; // 'YYYY-MM' -> total
  let totalAllTime = 0;
  let invoiceCount = 0;
  let encryptedPendingCount = 0;
  const priceIncreaseRows = [];

  rows.forEach((row) => {
    const dateStr = row[0];
    const from = row[1] || '';
    const status = row[3] || '';
    const amountStr = row[7];
    const changeLabel = row[8] || '';
    const driveLink = row[5] || '';

    if (!dateStr) return;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return;

    invoiceCount++;
    if (status.includes('נדרשת סיסמה')) encryptedPendingCount++;

    const amount = amountStr ? parseFloat(String(amountStr).replace(/,/g, '')) : null;
    if (amount !== null && !Number.isNaN(amount)) {
      totalAllTime += amount;
      const key = extractVendorKey(from);
      if (!vendorTotals[key]) vendorTotals[key] = { name: vendorDisplayName(from), total: 0, count: 0 };
      vendorTotals[key].total += amount;
      vendorTotals[key].count += 1;
      vendorTotals[key].name = vendorDisplayName(from); // תמיד עדכני לפי הרשומה האחרונה שנקראה

      const mk = monthKey(date);
      monthTotals[mk] = (monthTotals[mk] || 0) + amount;
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
    priceIncreaseCount: priceIncreaseRows.length,
    recentIncreases,
  };
}

module.exports = { buildStats, vendorDisplayName };
