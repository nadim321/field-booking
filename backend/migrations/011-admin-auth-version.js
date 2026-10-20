exports.up = async connection => {
  const [columns] = await connection.query('SHOW COLUMNS FROM users');
  if (!columns.some(column => column.Field === 'auth_version')) {
    await connection.query('ALTER TABLE users ADD COLUMN auth_version INT NOT NULL DEFAULT 0');
  }
};
