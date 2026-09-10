// GET /.netlify/functions/oauth-callback - גוגל מפנה לכאן אחרי אישור המשתמש
const { getOAuthClient } = require('./lib/googleAuth');

function page(bodyHtml) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><title>חיבור לגוגל</title>
<style>body{font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#222}
textarea{width:100%;height:70px;font-family:monospace;font-size:14px;padding:8px}
code{background:#f2f2f2;padding:2px 6px;border-radius:4px}</style>
</head><body>${bodyHtml}</body></html>`,
  };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};

  if (params.error) {
    return page(`<h2>ההתחברות בוטלה</h2><p>גוגל החזירה שגיאה: ${params.error}</p>`);
  }
  if (!params.code) {
    return page(`<h2>חסר קוד אימות</h2><p>לא התקבל פרמטר code בכתובת. נסו שוב מהדשבורד.</p>`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(params.code);

    if (tokens.refresh_token) {
      return page(`
        <h2>החיבור לגוגל הצליח 🎉</h2>
        <p>העתיקו את הערך הבא ושמרו אותו כמשתנה סביבה בשם <code>GMAIL_REFRESH_TOKEN</code>
        בהגדרות האתר ב-Netlify (Site settings → Environment variables), ואז בצעו Deploy מחדש לאתר:</p>
        <textarea readonly>${tokens.refresh_token}</textarea>
        <p>אחרי השמירה וה-Deploy מחדש אפשר לסגור את החלון הזה ולחזור לדשבורד.</p>
      `);
    }

    return page(`
      <h2>החיבור בוצע, אך לא התקבל refresh token חדש</h2>
      <p>זה קורה כשכבר אישרתם גישה בעבר. כדי לקבל refresh token חדש:</p>
      <ol>
        <li>גשו ל-<a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a></li>
        <li>מצאו את שם האפליקציה שלכם והסירו לה גישה</li>
        <li>חזרו לדשבורד ולחצו שוב על "התחברות לגוגל"</li>
      </ol>
    `);
  } catch (err) {
    return page(`<h2>שגיאה בקבלת אישור מגוגל</h2><p>${err.message}</p>`);
  }
};
