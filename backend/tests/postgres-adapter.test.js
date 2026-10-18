const test = require('node:test');
const assert = require('node:assert/strict');
const { translate, migrationSql } = require('../database/postgres');

test('PostgreSQL adapter expands placeholders and array filters', () => {
  assert.deepEqual(translate('SELECT * FROM slots WHERE id IN (?) AND is_active = ?', [[2, 4], 1]), {
    text: 'SELECT * FROM slots WHERE id IN ($1, $2) AND is_active = $3', values: [2, 4, 1]
  });
});

test('PostgreSQL adapter converts runtime MySQL expressions and upserts', () => {
  assert.deepEqual(translate('SELECT TIME(start_time), UNIX_TIMESTAMP(expires_at) FROM slot_holds WHERE expires_at > DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)', [7]), {
    text: "SELECT (start_time)::time, EXTRACT(EPOCH FROM expires_at) FROM slot_holds WHERE expires_at > (CURRENT_TIMESTAMP + ($1 * INTERVAL '1 MINUTE'))",
    values: [7]
  });
  assert.deepEqual(translate('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['x', 'y', 'y']), {
    text: 'INSERT INTO app_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value', values: ['x', 'y']
  });
});

test('PostgreSQL migrations convert MySQL auto IDs, types, and metadata queries', () => {
  assert.match(migrationSql('CREATE TABLE jobs (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, created_at DATETIME) ENGINE=InnoDB'), /BIGSERIAL PRIMARY KEY/);
  assert.match(migrationSql('CREATE TABLE jobs (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, created_at DATETIME) ENGINE=InnoDB'), /created_at TIMESTAMP/);
  assert.match(migrationSql('SHOW COLUMNS FROM bookings'), /information_schema\.columns/);
});
