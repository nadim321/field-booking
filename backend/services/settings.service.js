/**
 * Settings Service
 * -----------------
 * Thin helper over the generic `app_settings` key-value table. Currently
 * only `advance_payment_percentage` is used, but this stays generic so
 * future admin-configurable values don't each need a new column/endpoint.
 */

const db = require('../database');

const DEFAULTS = {
  advance_payment_percentage: '25'
};

/** Gets a setting value as a raw string, falling back to the in-code
 * default if the row doesn't exist for some reason (e.g. fresh DB before
 * seeding finished, or migration not yet run). */
function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [key],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.setting_value : (DEFAULTS[key] ?? null));
      }
    );
  });
}

/** Gets the advance payment percentage as a number (e.g. 25, not "25"). */
async function getAdvancePaymentPercentage() {
  const raw = await getSetting('advance_payment_percentage');
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed <= 0 || parsed > 100) {
    // Defensive fallback -- a corrupted/invalid stored value should never
    // crash a payment calculation, just fall back to the safe default.
    return parseFloat(DEFAULTS.advance_payment_percentage);
  }
  return parsed;
}

/** Upserts a setting value. */
function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [key, String(value), String(value)],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

module.exports = {
  getSetting,
  setSetting,
  getAdvancePaymentPercentage
};
