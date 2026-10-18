exports.up = async c => {
  await c.query(`CREATE TABLE IF NOT EXISTS booking_collections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, booking_id INT NOT NULL,
    kind VARCHAR(20) NOT NULL, amount DECIMAL(10,2) NOT NULL, method VARCHAR(30) NOT NULL,
    reference VARCHAR(150) NULL, reference_key VARCHAR(190) NULL UNIQUE,
    note VARCHAR(500) NOT NULL DEFAULT '', actor_id INT NULL, actor_name VARCHAR(255) NULL,
    created_at BIGINT NULL, recorded_at BIGINT NOT NULL,
    reversal_of BIGINT UNSIGNED NULL UNIQUE, gateway_transaction_id INT NULL UNIQUE,
    legacy_booking_id INT NULL UNIQUE,
    KEY ix_collection_date (created_at,id), KEY ix_collection_booking (booking_id,id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
    FOREIGN KEY (reversal_of) REFERENCES booking_collections(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);
  await c.query(`CREATE TABLE IF NOT EXISTS collection_requests (
    request_key VARCHAR(64) PRIMARY KEY, actor_id INT NOT NULL, payload_hash CHAR(64) NOT NULL,
    collection_id BIGINT UNSIGNED NOT NULL, created_at BIGINT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES booking_collections(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);
  // A single statement is atomic and restart-safe. Receipt time/method/staff are unknown.
  await c.query(`INSERT INTO booking_collections
    (booking_id,kind,amount,method,note,recorded_at,legacy_booking_id)
    SELECT b.id,'opening',COALESCE(b.amount_paid,0),'legacy','Legacy opening balance; receipt details unknown',
      UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000,b.id FROM bookings b
    WHERE NOT EXISTS (SELECT 1 FROM booking_collections c WHERE c.booking_id=b.id)
    ON DUPLICATE KEY UPDATE legacy_booking_id=VALUES(legacy_booking_id)`);
};
