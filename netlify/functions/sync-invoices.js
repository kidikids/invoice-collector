// טריגר ידני מהדשבורד: POST /.netlify/functions/sync-invoices?dryRun=true|false&daysBack=60
// daysBack אופציונלי - משמש את מסך "חיפוש היסטורי" למשיכה לאחור לטווח רחב יותר מברירת המחדל.
const { runSync } = require('./lib/runSync');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const dryRun = params.dryRun === 'true';
  const daysBack = params.daysBack ? Number(params.daysBack) : undefined;

  try {
    const results = await runSync({ dryRun, daysBack });
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
