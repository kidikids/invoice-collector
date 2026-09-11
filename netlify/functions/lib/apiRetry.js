// עוטף קריאת API של גוגל (בעיקר Gmail) בניסיון חוזר עם השהיה גדלה, למקרה של
// שגיאת מכסה זמנית ("Quota exceeded" / "Rate Limit Exceeded" / קוד 429) - כדי
// שסריקות עם הרבה קריאות ברצף (גילוי ספקים, סנכרון היסטורי לטווח רחב) יתמודדו
// איתה לבד ברוב המקרים, במקום להיכשל מיד באמצע.

function isQuotaError(err) {
  const code = err && (err.code || (err.response && err.response.status));
  const message = String((err && err.message) || '');
  return code === 429 || /quota exceeded|rate limit exceeded/i.test(message);
}

async function withRetry(fn, { retries = 5, baseDelayMs = 1000 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isQuotaError(err) || attempt >= retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 300;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
}

module.exports = { withRetry, isQuotaError };
