/**
 * Slot Category constants
 * -------------------------
 * The single source of truth for the int <-> label mapping used on the
 * `slots.category` column. Categories are assigned MANUALLY by the admin
 * per slot (see server.js admin slot create/update routes) -- they are
 * NOT automatically derived from start_time. The hour ranges below are
 * only the business's general intent for each label; a slot's actual
 * category can be any value the admin chooses, regardless of its time.
 *
 * To add/rename a category in the future, change ONLY this file --
 * server.js reads from here for validation and label lookup, and the
 * frontend keeps its own matching copy of this map (see
 * booking-portal.component.ts SLOT_CATEGORIES) for type safety and to
 * avoid an extra round-trip just to resolve a label.
 */

const SLOT_CATEGORIES = {
  1: 'Morning',   // intended ~6:00 AM - 12:00 PM
  2: 'Afternoon', // intended ~12:00 PM - 4:00 PM
  3: 'Evening',   // intended ~4:00 PM - 7:00 PM
  4: 'Night',     // intended ~7:00 PM - 12:00 AM
  5: 'Midnight'   // intended ~12:00 AM - 6:00 AM
};

const VALID_CATEGORY_IDS = Object.keys(SLOT_CATEGORIES).map(Number);

function isValidCategory(value) {
  return VALID_CATEGORY_IDS.includes(Number(value));
}

function categoryLabel(value) {
  return SLOT_CATEGORIES[value] || null;
}

module.exports = {
  SLOT_CATEGORIES,
  VALID_CATEGORY_IDS,
  isValidCategory,
  categoryLabel
};
