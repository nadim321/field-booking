// DATE columns arrive as JS Date objects at *local* midnight (mysql2 and pg both
// do this), so read the local calendar fields. Strings pass through unchanged.
function dateOnly(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
}
module.exports = { dateOnly };
