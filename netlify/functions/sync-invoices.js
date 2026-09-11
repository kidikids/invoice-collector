// טריגר ידני מהדשבורד: POST /.netlify/functions/sync-invoices?dryRun=true|false&daysBack=60&focusKeys=a@b.com,c.co.il
// daysBack אופציונלי - משמש את מסך "חיפוש היסטורי" למשיכה לאחור לטווח רחב יותר מברירת המחדל.
// focusKeys אופציונלי (רשימת כתובות/דומיינים מופרדת בפסיקים) - משמש את מסך
// "הספקים הקבועים שלי" לסריקה ממוקדת רק לספקים שנוספו זה עתה.
const { runSync } = require('./lib/runSync');
const { isQuotaError } = require('./lib/apiRetry');

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
    if (isQuotaError(err)) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(
          {
            error:
              'חריגה זמנית ממכסת השימוש ב-Gmail (קורה כשמסנכרנים הרבה חשבוניות בבת אחת, בעיקר בסריקות היסטוריות לטווח רחב). המערכת כבר ניסתה שוב כמה פעמים לבד, אך המכסה עדיין עמוסה - חכו 2-3 דקות ונסו שוב, ואם אפשר עם טווח קצר יותר או פחות ספקים בבת אחת.',
          },
          null,
          2
        ),
      };
    }
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: err.message }, null, 2),
    };
  }
};
