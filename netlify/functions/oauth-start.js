// GET /.netlify/functions/oauth-start - מפנה למסך ההרשאות של גוגל
const { getOAuthClient, SCOPES } = require('./lib/googleAuth');

exports.handler = async () => {
  try {
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // מבטיח קבלת refresh_token גם אם כבר אישרתם בעבר
      scope: SCOPES,
    });
    return { statusCode: 302, headers: { Location: url } };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'שגיאה: ' + err.message,
    };
  }
};
