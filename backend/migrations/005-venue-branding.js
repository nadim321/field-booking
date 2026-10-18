exports.up = async connection => {
  await connection.query('ALTER TABLE app_settings MODIFY setting_value TEXT NOT NULL');
  await connection.query(`CREATE TABLE IF NOT EXISTS venue_media (
    id CHAR(36) PRIMARY KEY, kind VARCHAR(10) NOT NULL, filename VARCHAR(60) NOT NULL UNIQUE,
    width INT NOT NULL, height INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await connection.query("INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES ('branding_lock','1')");
};
