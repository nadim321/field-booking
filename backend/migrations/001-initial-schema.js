exports.up = async connection => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'admin'
    ) ENGINE=InnoDB
  `);
  await connection.query(`
      CREATE TABLE IF NOT EXISTS slots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        start_time VARCHAR(10) NOT NULL,
        end_time VARCHAR(10) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        is_active INT DEFAULT 1,
        category INT NULL
      ) ENGINE=InnoDB
    `);
  await connection.query(`
        CREATE TABLE IF NOT EXISTS slot_holds (
          id INT AUTO_INCREMENT PRIMARY KEY,
          slot_id INT NOT NULL,
          booking_date VARCHAR(50) NOT NULL,
          session_token VARCHAR(255) NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
          INDEX idx_slot_date_expiry (slot_id, booking_date, expires_at)
        ) ENGINE=InnoDB
      `);
  await connection.query(`
          CREATE TABLE IF NOT EXISTS recurring_bookings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            slot_id INT NOT NULL,
            day_of_week TINYINT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            customer_name VARCHAR(255) NOT NULL,
            customer_phone VARCHAR(50) NOT NULL,
            customer_email VARCHAR(255),
            team_name VARCHAR(255),
            status VARCHAR(50) DEFAULT 'pending_approval',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE
          ) ENGINE=InnoDB
        `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slot_id INT NOT NULL,
      booking_date VARCHAR(50) NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(50) NOT NULL,
      customer_email VARCHAR(255),
      team_name VARCHAR(255),
      status VARCHAR(50) DEFAULT 'pending',
      payment_status VARCHAR(50) DEFAULT 'unpaid',
      payment_method VARCHAR(50) NULL,
      transaction_id VARCHAR(100) NULL,
      amount_paid DECIMAL(10,2) DEFAULT 0,
      recurring_booking_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT uq_slot_date UNIQUE (slot_id, booking_date),

      FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
      FOREIGN KEY (recurring_booking_id) REFERENCES recurring_bookings(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  await connection.query(`
            CREATE TABLE IF NOT EXISTS payment_transactions (
              id INT AUTO_INCREMENT PRIMARY KEY,
              booking_id INT NOT NULL,
              tran_id VARCHAR(100) NOT NULL UNIQUE,
              amount DECIMAL(10,2) NOT NULL,
              currency VARCHAR(10) DEFAULT 'BDT',
              status VARCHAR(30) DEFAULT 'initiated',
              val_id VARCHAR(100) NULL,
              card_type VARCHAR(50) NULL,
              bank_tran_id VARCHAR(100) NULL,
              raw_ipn_payload TEXT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
            ) ENGINE=InnoDB
          `);
  await connection.query(`
              CREATE TABLE IF NOT EXISTS app_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value VARCHAR(255) NOT NULL
              ) ENGINE=InnoDB
            `);
  await connection.query(`
                CREATE TABLE IF NOT EXISTS slot_blocks (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  slot_id INT NOT NULL,
                  block_date VARCHAR(10) NOT NULL,
                  reason VARCHAR(255) NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE KEY uq_slot_block_date (slot_id, block_date),
                  FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
                  INDEX idx_block_date (block_date)
                ) ENGINE=InnoDB
              `);
};
