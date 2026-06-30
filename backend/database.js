const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
};

const dbName = process.env.DB_NAME || 'turf_booking';

// Step 1: Create connection to verify database exists, create if missing
const initConnection = mysql.createConnection(dbConfig);

initConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``, (err) => {
  if (err) {
    console.error('Error verifying/creating MySQL database:', err.message);
    initConnection.end();
    return;
  }
  console.log(`MySQL Database '${dbName}' verified/created.`);
  initConnection.end();

  // Step 2: Initialize connection pool
  initializePool();
});

let pool;

// Compatibility shim mapping sqlite3 callbacks to mysql2 pooling structure
const dbWrapper = {
  getConnection: (cb) => {
    pool.getConnection(cb);
  },
  all: (sql, params, cb) => {
    pool.query(sql, params, (err, results) => {
      if (err) {
        cb(err, null);
      } else {
        cb(null, results);
      }
    });
  },
  get: (sql, params, cb) => {
    pool.query(sql, params, (err, results) => {
      if (err) {
        cb(err, null);
      } else {
        cb(null, results && results.length > 0 ? results[0] : null);
      }
    });
  },
  run: function (sql, params, cb) {
    pool.query(sql, params, function (err, result) {
      const context = {
        lastID: result ? result.insertId : null,
        changes: result ? result.affectedRows : null
      };
      if (cb) {
        cb.call(context, err);
      }
    });
  },
  prepare: (sql) => {
    const runs = [];
    return {
      run: function (...args) {
        runs.push(args);
      },
      finalize: function (cb) {
        let completed = 0;
        let hasError = null;
        if (runs.length === 0) {
          if (cb) cb(null);
          return;
        }
        runs.forEach(args => {
          pool.query(sql, args, (err) => {
            if (err) hasError = err;
            completed++;
            if (completed === runs.length) {
              if (cb) cb(hasError);
            }
          });
        });
      }
    };
  }
};

function initializePool() {
  pool = mysql.createPool({
    ...dbConfig,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  console.log('MySQL Connection Pool initialized.');

  // Create tables using InnoDB engine
  dbWrapper.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'admin'
    ) ENGINE=InnoDB
  `, [], (err) => {
    if (err) console.error("Error creating users table:", err.message);

    dbWrapper.run(`
      CREATE TABLE IF NOT EXISTS slots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        start_time VARCHAR(10) NOT NULL,
        end_time VARCHAR(10) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        is_active INT DEFAULT 1,
        category INT NULL
      ) ENGINE=InnoDB
    `, [], (err) => {
      if (err) console.error("Error creating slots table:", err.message);

      // NOTE: No UNIQUE KEY on (slot_id, booking_date) here.
      // A unique constraint on those two columns would permanently block
      // re-holding a slot/date combination once a hold for it had ever
      // existed, even after that hold expired (UNIQUE doesn't care about
      // expires_at). Instead, "is this slot/date free to hold" is decided
      // at query time by filtering on expires_at > NOW(), exactly like the
      // existing /api/slots/available logic already does for reads.
      dbWrapper.run(`
        CREATE TABLE IF NOT EXISTS slot_holds (
          id INT AUTO_INCREMENT PRIMARY KEY,
          slot_id INT NOT NULL,
          booking_date VARCHAR(50) NOT NULL,
          session_token VARCHAR(255) NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
          INDEX idx_slot_date_expiry (slot_id, booking_date, expires_at)
        ) ENGINE=InnoDB
      `, [], (err) => {

        if (err) {
          console.error("Error creating slot_holds table:", err.message);
          return;
        }

        // recurring_bookings holds the *template* for a season/recurring
        // booking request. Individual weekly occurrences are generated
        // into the `bookings` table by the scheduler in
        // services/recurring/recurring-booking.scheduler.js -- this table
        // itself never represents an actual reservation on its own.
        //
        // Status lifecycle:
        //   pending_approval -> active -> (paused <-> active) -> cancelled
        //                                                      -> expired
        // 'expired' is set automatically by the scheduler once end_date
        // has passed; all other transitions are admin actions.
        dbWrapper.run(`
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
        `, [], (err) => {
          if (err) {
            console.error("Error creating recurring_bookings table:", err.message);
            return;
          }

          dbWrapper.run(`
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
  `, [], (err) => {

            if (err) {
              console.error("Error creating bookings table:", err.message);
              return;
            }

            // payment_transactions is the full audit trail of every payment
            // attempt against a booking (initiated, validated, failed,
            // cancelled, expired) -- bookings.transaction_id/amount_paid only
            // cache the LATEST successful state for quick access; this table
            // is the source of truth for history/debugging.
            dbWrapper.run(`
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
          `, [], (err) => {
              if (err) {
                console.error("Error creating payment_transactions table:", err.message);
                return;
              }

              // Generic key-value settings table. Currently only used for
              // advance_payment_percentage, but kept generic so future
              // admin-configurable values don't each need their own column
              // or migration.
              dbWrapper.run(`
              CREATE TABLE IF NOT EXISTS app_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value VARCHAR(255) NOT NULL
              ) ENGINE=InnoDB
            `, [], (err) => {
                if (err) {
                  console.error("Error creating app_settings table:", err.message);
                  return;
                }

              // slot_blocks: Admin-created blocks for specific slot + date
              // combinations (e.g. maintenance, tournament, holiday).
              // Unlike slot_holds (temporary customer holds), these are
              // permanent until explicitly removed by an admin action.
              // A block takes priority over any hold or availability check
              // in GET /api/slots/available.
              dbWrapper.run(`
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
              `, [], (err) => {
                if (err) {
                  console.error("Error creating slot_blocks table:", err.message);
                  return;
                }
                seedData();
              });
            });
            });
          });

        });

      });
    });
  });
}

function seedData() {
  // Seed default app settings
  dbWrapper.get("SELECT COUNT(*) as count FROM app_settings", [], (err, row) => {
    if (err) {
      console.error("Error checking app_settings count:", err.message);
      return;
    }
    const count = row ? (row.count || 0) : 0;
    if (count === 0) {
      dbWrapper.run(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)",
        ['advance_payment_percentage', '25'],
        (err) => {
          if (err) {
            console.error("Error seeding default app settings:", err.message);
          } else {
            console.log("Default app settings seeded (advance_payment_percentage=25).");
          }
        }
      );
    }
  });

  // Seed default admin user
  dbWrapper.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
    if (err) {
      console.error("Error checking users count:", err.message);
      return;
    }
    // MySQL returns row.count, but check if row exists first
    const count = row ? (row.count || 0) : 0;
    if (count === 0) {
      const defaultAdmin = 'admin';
      const defaultPass = 'admin123';
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(defaultPass, salt);

      dbWrapper.run(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        [defaultAdmin, hashedPassword, 'admin'],
        (err) => {
          if (err) {
            console.error("Error seeding default admin:", err.message);
          } else {
            console.log(`Default admin user seeded: Username: '${defaultAdmin}', Password: '${defaultPass}'`);
          }
        }
      );
    }
  });

  // Seed default slots
  dbWrapper.get("SELECT COUNT(*) as count FROM slots", [], (err, row) => {
    if (err) {
      console.error("Error checking slots count:", err.message);
      return;
    }
    const count = row ? (row.count || 0) : 0;
    if (count === 0) {
      // Category values: 1=Morning, 2=Afternoon, 3=Evening, 4=Night, 5=Midnight
      // (see constants/slot-categories.js for the canonical mapping used
      // everywhere else in the app). Assigned here using the boundaries
      // the business defined: Morning 6am-12pm, Afternoon 12pm-4pm,
      // Evening 4pm-7pm, Night 7pm-12am, Midnight 12am-6am. This is a
      // one-time convenience for fresh installs only -- categories on
      // slots added later via the admin panel are always chosen manually.
      const defaultSlots = [
        { start: '00:00', end: '01:00', price: 1000, category: 5 },
        { start: '01:00', end: '02:00', price: 1000, category: 5 },
        { start: '02:00', end: '03:00', price: 1000, category: 5 },
        { start: '03:00', end: '04:00', price: 1000, category: 5 },
        { start: '04:00', end: '05:00', price: 1000, category: 5 },
        { start: '05:00', end: '06:00', price: 1000, category: 5 },
        { start: '06:00', end: '07:00', price: 1000, category: 1 },
        { start: '07:00', end: '08:00', price: 1000, category: 1 },
        { start: '08:00', end: '09:00', price: 1000, category: 1 },
        { start: '09:00', end: '10:00', price: 1000, category: 1 },
        { start: '10:00', end: '11:00', price: 1000, category: 1 },
        { start: '11:00', end: '12:00', price: 1000, category: 1 },
        { start: '12:00', end: '13:00', price: 1200, category: 2 },
        { start: '13:00', end: '14:00', price: 1200, category: 2 },
        { start: '14:00', end: '15:00', price: 1200, category: 2 },
        { start: '15:00', end: '16:00', price: 1200, category: 2 },
        { start: '16:00', end: '17:00', price: 1500, category: 3 },
        { start: '17:00', end: '18:00', price: 1500, category: 3 },
        { start: '18:00', end: '19:00', price: 1800, category: 3 },
        { start: '19:00', end: '20:00', price: 1800, category: 4 },
        { start: '20:00', end: '21:00', price: 1800, category: 4 },
        { start: '21:00', end: '22:00', price: 1500, category: 4 },
        { start: '22:00', end: '23:00', price: 1200, category: 4 },
        { start: '23:00', end: '00:00', price: 1000, category: 4 }
      ];

      const stmt = dbWrapper.prepare("INSERT INTO slots (start_time, end_time, price, is_active, category) VALUES (?, ?, ?, 1, ?)");
      defaultSlots.forEach(slot => {
        stmt.run(slot.start, slot.end, slot.price, slot.category);
      });
      stmt.finalize((err) => {
        if (err) {
          console.error("Error seeding default slots:", err.message);
        } else {
          console.log("Default turf slots successfully seeded!");
        }
      });
    }
  });
}

module.exports = dbWrapper;