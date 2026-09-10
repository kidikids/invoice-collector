const { google } = require('googleapis');

// יוצר לקוח OAuth2 של גוגל. אם קיים GMAIL_REFRESH_TOKEN בהגדרות הסביבה,
// הלקוח כבר יהיה מוכן לשימוש מול Gmail / Drive / Sheets בלי צורך בהתחברות נוספת.
function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'חסרים משתני סביבה: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI. ' +
        'ראו README להגדרה.'
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  if (process.env.GMAIL_REFRESH_TOKEN) {
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  }

  return oauth2Client;
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

module.exports = { getOAuthClient, SCOPES };
