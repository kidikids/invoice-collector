// הרצה אוטומטית יומית (ברירת מחדל: 05:00 UTC, כ-07:00-08:00 בישראל בהתאם לשעון קיץ).
// לשינוי התדירות/השעה - עדכנו את ביטוי ה-cron למטה ופרסו מחדש.
const { schedule } = require('@netlify/functions');
const { runSync } = require('./lib/runSync');

const handler = async () => {
  try {
    const results = await runSync({ dryRun: false });
    console.log('סנכרון חשבוניות יומי הושלם:', JSON.stringify(results));
  } catch (err) {
    console.error('סנכרון חשבוניות יומי נכשל:', err.message);
  }
  return { statusCode: 200 };
};

exports.handler = schedule('0 5 * * *', handler);
