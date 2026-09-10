// זיהוי (לא פענוח!) של קובץ PDF מוגן בסיסמה.
// קבצי PDF מוצפנים מכילים ערך /Encrypt במילון ה-trailer של הקובץ.
// זו בדיקה מהירה מבוססת סריקת בייטים, בלי צורך בספריית PDF מלאה.
function isPdfEncrypted(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const text = buffer.toString('latin1');
  return /\/Encrypt\b/.test(text);
}

module.exports = { isPdfEncrypted };
