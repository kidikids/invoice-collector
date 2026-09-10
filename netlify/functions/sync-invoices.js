// טריגר ידני מהדשבורד: POST /.netlify/functions/sync-invoices?dryRun=true|false
const { runSync } = require('./lib/runSync');

exports.handler = async (event) => {
  const dryRun = !!(event.queryStringParameters && event.queryStringParameters.dryRun === 'true');

  try {
    const results = await runSync({ dryRun });
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
