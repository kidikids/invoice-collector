// טריגר ידני מהדשבורד: POST /.netlify/functions/sync-invoices?dryRun=true|false&daysBack=60&focusKeys=a@b.com,c.co.il
// daysBack אופציונלי - משמש את מסך "חיפוש היסטורי" למשיכה לאחור לטווח רחב יותר מברירת המחדל.
// focusKeys אופציונלי (רשימת כתובות/דומיינים מופרדת בפסיקים) - משמש את מסך
// "הספקים הקבועים שלי" לסריקה ממוקדת רק לספקים שנוספו זה עתה.
const { runSync } = require('./lib/runSync');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const dryRun = params.dryRun === 'true';
  const daysBack = params.daysBack ? Number(params.daysBack) : undefined;
  const focusKeys = params.focusKeys
    ? params.focusKeys.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  try {
    const results = await runSync({ dryRun, daysBack, focusKeys });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(results, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: err.message }, null, 2),
    };
  }
};
