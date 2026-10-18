exports.up = async connection => {
  const [columns] = await connection.query('SHOW COLUMNS FROM bookings');
  const names = new Set(columns.map(column => column.Field));
  if (!names.has('booking_price')) await connection.query('ALTER TABLE bookings ADD COLUMN booking_price DECIMAL(10,2) NULL');
  if (!names.has('price_source')) await connection.query('ALTER TABLE bookings ADD COLUMN price_source VARCHAR(30) NULL');
  // Only previously unsnapshotted records are estimated. Never reprice a retry.
  await connection.query(`UPDATE bookings b JOIN slots s ON s.id = b.slot_id
    SET b.booking_price = s.price, b.price_source = 'legacy_estimate' WHERE b.booking_price IS NULL`);
  await connection.query("UPDATE bookings SET price_source = 'legacy_estimate' WHERE price_source IS NULL");
  await connection.query(`ALTER TABLE bookings
    MODIFY booking_price DECIMAL(10,2) NOT NULL,
    MODIFY price_source VARCHAR(30) NOT NULL`);
};
