const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const authenticateAdmin = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'turf_booking_super_secret_key_123!@#';

// Middleware
app.use(cors());
app.use(express.json());

// Serve Angular static files from the 'public' subfolder
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));

// --- PUBLIC ROUTES ---

// 1. Admin Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error occurred', error: err.message });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful',
      token,
      admin: { id: user.id, username: user.username }
    });
  });
});

// 2. Get Available Slots for a Specific Date
app.get('/api/slots/available', (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ message: 'Date query parameter is required (format: YYYY-MM-DD)' });
  }

  // Determine current server time in Bangladesh timezone (UTC+6)
  const now = new Date();
  const bdOffset = 6 * 60; // UTC+6 in minutes
  const bdNow = new Date(now.getTime() + (bdOffset + now.getTimezoneOffset()) * 60000);

  // Build today's date string in YYYY-MM-DD format
  const todayStr = bdNow.toISOString().slice(0, 10);
  const isToday = date === todayStr;

  // Current time as "HH:MM" string for comparison
  const currentTimeStr = bdNow.toTimeString().slice(0, 5);

  // First, get all configurations of active slots
  db.all('SELECT * FROM slots WHERE is_active = 1 ORDER BY start_time ASC', [], (err, slots) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to retrieve slots', error: err.message });
    }

    // If viewing today, remove slots whose end_time has already passed
    const visibleSlots = isToday
      ? slots.filter(slot => slot.end_time > currentTimeStr)
      : slots;

    // Next, get all approved/pending bookings for this date
    db.all(
      `SELECT b.*, s.start_time, s.end_time 
       FROM bookings b 
       JOIN slots s ON b.slot_id = s.id 
       WHERE b.booking_date = ? AND b.status IN ('pending', 'approved')`,
      [date],
      (err, bookings) => {
        if (err) {
          return res.status(500).json({ message: 'Failed to retrieve bookings', error: err.message });
        }

        // Map slot config and join bookings info
        const result = visibleSlots.map(slot => {
          const bookingForSlot = bookings.find(b => b.slot_id === slot.id);

          // For today, if slot has started but not yet ended, mark as unavailable for new booking
          const hasStarted = isToday && slot.start_time <= currentTimeStr;

          return {
            id: slot.id,
            start_time: slot.start_time,
            end_time: slot.end_time,
            price: slot.price,
            is_active: slot.is_active,
            status: bookingForSlot
              ? bookingForSlot.status
              : hasStarted ? 'approved' : 'available', // treat in-progress as booked visually
            booking_details: bookingForSlot ? {
              booking_id: bookingForSlot.id,
              team_name: bookingForSlot.team_name,
              payment_status: bookingForSlot.payment_status
            } : null
          };
        });

        res.json({ date, slots: result, server_time: currentTimeStr, is_today: isToday });
      }
    );
  });
});


// 3. Request a Booking (Customer Facing)
app.post('/api/bookings', (req, res) => {
  const { slot_id, booking_date, customer_name, customer_phone, customer_email, team_name } = req.body;

  if (!slot_id || !booking_date || !customer_name || !customer_phone) {
    return res.status(400).json({ message: 'Required fields: slot_id, booking_date, customer_name, customer_phone' });
  }

  // Verify slot is active
  db.get('SELECT * FROM slots WHERE id = ? AND is_active = 1', [slot_id], (err, slot) => {
    if (err) {
      return res.status(500).json({ message: 'Database error', error: err.message });
    }
    if (!slot) {
      return res.status(400).json({ message: 'Selected slot is not active or does not exist' });
    }

    // Verify slot is not already booked/pending for this date
    db.get(
      "SELECT * FROM bookings WHERE slot_id = ? AND booking_date = ? AND status IN ('pending', 'approved')",
      [slot_id, booking_date],
      (err, booking) => {
        if (err) {
          return res.status(500).json({ message: 'Database error', error: err.message });
        }
        if (booking) {
          return res.status(409).json({ message: 'This slot is already booked or has a pending reservation for the selected date' });
        }

        // Create booking with status 'pending'
        db.run(
          `INSERT INTO bookings (slot_id, booking_date, customer_name, customer_phone, customer_email, team_name, status, payment_status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`,
          [slot_id, booking_date, customer_name, customer_phone, customer_email, team_name],
          function (err) {
            if (err) {
              return res.status(500).json({ message: 'Failed to create booking request', error: err.message });
            }

            res.status(201).json({
              message: 'Booking request submitted successfully! Pending admin approval.',
              booking_id: this.lastID,
              details: {
                slot_id,
                booking_date,
                customer_name,
                customer_phone,
                team_name,
                price: slot.price
              }
            });
          }
        );
      }
    );
  });
});


// --- ADMIN SECURE ROUTES ---

// 1. Get All Bookings for Admin Dashboard
app.get('/api/admin/bookings', authenticateAdmin, (req, res) => {
  db.all(
    `SELECT b.*, s.start_time, s.end_time, s.price 
     FROM bookings b
     JOIN slots s ON b.slot_id = s.id
     ORDER BY b.booking_date DESC, s.start_time ASC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to retrieve bookings', error: err.message });
      }
      res.json(rows);
    }
  );
});

// 2. Update Booking Status / Payment Status (Approve/Cancel/Pay)
app.put('/api/admin/bookings/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status, payment_status } = req.body;

  // Build dynamic update query
  let updateFields = [];
  let params = [];

  if (status) {
    if (!['pending', 'approved', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    updateFields.push('status = ?');
    params.push(status);
  }

  if (payment_status) {
    if (!['paid', 'unpaid'].includes(payment_status)) {
      return res.status(400).json({ message: 'Invalid payment status value' });
    }
    updateFields.push('payment_status = ?');
    params.push(payment_status);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ message: 'Provide status or payment_status to update' });
  }

  params.push(id);

  db.run(
    `UPDATE bookings SET ${updateFields.join(', ')} WHERE id = ?`,
    params,
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to update booking', error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Booking not found' });
      }
      res.json({ message: 'Booking updated successfully' });
    }
  );
});

// 3. Delete Booking
app.delete('/api/admin/bookings/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM bookings WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to delete booking', error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    res.json({ message: 'Booking deleted successfully' });
  });
});

// 4. Manage Slots Configurations
app.get('/api/admin/slots', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM slots ORDER BY start_time ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to retrieve slots template', error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/admin/slots', authenticateAdmin, (req, res) => {
  const { start_time, end_time, price, is_active } = req.body;

  if (!start_time || !end_time || price === undefined) {
    return res.status(400).json({ message: 'Required fields: start_time, end_time, price' });
  }

  db.run(
    'INSERT INTO slots (start_time, end_time, price, is_active) VALUES (?, ?, ?, ?)',
    [start_time, end_time, price, is_active !== undefined ? is_active : 1],
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to create slot template', error: err.message });
      }
      res.status(201).json({
        message: 'Slot template created successfully',
        slot_id: this.lastID
      });
    }
  );
});

app.put('/api/admin/slots/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, price, is_active } = req.body;

  db.run(
    `UPDATE slots 
     SET start_time = COALESCE(?, start_time), 
         end_time = COALESCE(?, end_time), 
         price = COALESCE(?, price), 
         is_active = COALESCE(?, is_active)
     WHERE id = ?`,
    [start_time, end_time, price, is_active, id],
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to update slot configuration', error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Slot configuration not found' });
      }
      res.json({ message: 'Slot configuration updated successfully' });
    }
  );
});

app.delete('/api/admin/slots/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM slots WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to delete slot configuration', error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Slot configuration not found' });
    }
    res.json({ message: 'Slot configuration deleted successfully' });
  });
});

// 5. Admin Dashboard Statistics
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const stats = {};

  // Query 1: Total Bookings by status
  db.all(
    `SELECT status, COUNT(*) as count FROM bookings GROUP BY status`,
    [],
    (err, statusCounts) => {
      if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

      stats.bookings = {
        total: 0,
        pending: 0,
        approved: 0,
        cancelled: 0
      };

      statusCounts.forEach(row => {
        stats.bookings[row.status] = row.count;
        stats.bookings.total += row.count;
      });

      // Query 2: Revenue metrics (sum price of approved slots)
      db.get(
        `SELECT SUM(s.price) as total_revenue,
                SUM(CASE WHEN b.payment_status = 'paid' THEN s.price ELSE 0 END) as paid_revenue
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         WHERE b.status = 'approved'`,
        [],
        (err, revRow) => {
          if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

          stats.revenue = {
            total_approved: revRow.total_revenue || 0,
            total_paid: revRow.paid_revenue || 0,
            pending_payment: (revRow.total_revenue || 0) - (revRow.paid_revenue || 0)
          };

          // Query 3: Slot Popularity (Which hours booked most)
          db.all(
            `SELECT s.start_time, s.end_time, COUNT(*) as booking_count 
             FROM bookings b
             JOIN slots s ON b.slot_id = s.id
             WHERE b.status = 'approved'
             GROUP BY b.slot_id, s.start_time, s.end_time
             ORDER BY booking_count DESC
             LIMIT 5`,
            [],
            (err, popularSlots) => {
              if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

              stats.popular_slots = popularSlots;

              // Query 4: Daily occupancy for the last 7 days
              db.all(
                `SELECT b.booking_date, COUNT(*) as count
                 FROM bookings b
                 WHERE b.status = 'approved'
                 GROUP BY b.booking_date
                 ORDER BY b.booking_date DESC
                 LIMIT 7`,
                [],
                (err, dailyCounts) => {
                  if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

                  stats.recent_occupancy = dailyCounts;
                  res.json(stats);
                }
              );
            }
          );
        }
      );
    }
  );
});


// --- FUTURE PAYMENT GATEWAY INTEGRATION PLACEHOLDER ---
// Under normal circumstances, this endpoint would trigger checkout page for Bkash/SSLCommerz/Stripe
app.post('/api/payments/checkout', (req, res) => {
  const { booking_id, payment_method } = req.body;

  if (!booking_id || !payment_method) {
    return res.status(400).json({ message: 'Required fields: booking_id, payment_method' });
  }

  // 1. Fetch booking details to get the amount
  db.get(
    `SELECT b.*, s.price 
     FROM bookings b 
     JOIN slots s ON b.slot_id = s.id 
     WHERE b.id = ?`,
    [booking_id],
    (err, booking) => {
      if (err) {
        return res.status(500).json({ message: 'Database error', error: err.message });
      }
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      // Mock Transaction
      const mockTransactionId = 'TRX_MOCK_' + Math.random().toString(36).substring(2, 10).toUpperCase();

      // If SSLCommerz/Bkash/Stripe is integrated, you would make an API call to their server here
      // and send back a redirect URL (checkout URL) to the frontend.
      // For now, we mock the success response.
      res.json({
        message: 'Payment checkout initiated (MOCK)',
        booking_id: booking.id,
        amount: booking.price,
        payment_method,
        transaction_id: mockTransactionId,
        checkout_url: `http://localhost:${PORT}/api/payments/mock-redirect?trx_id=${mockTransactionId}&booking_id=${booking.id}`
      });
    }
  );
});

// Mock redirect endpoint that simulates payment processor approval redirection
app.get('/api/payments/mock-redirect', (req, res) => {
  const { trx_id, booking_id } = req.query;

  if (!booking_id) {
    return res.send('<h1>Error: Missing booking details</h1>');
  }

  // Update booking as approved and paid
  db.run(
    "UPDATE bookings SET status = 'approved', payment_status = 'paid' WHERE id = ?",
    [booking_id],
    (err) => {
      if (err) {
        return res.status(500).send('<h1>Database error during payment verification</h1>');
      }

      // In a real app, this redirects back to the Angular frontend success page
      res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
          <h1 style="color: #047857;">⚽ Payment Successful!</h1>
          <p style="font-size: 18px; color: #4b5563;">Your payment has been successfully processed.</p>
          <p><strong>Booking ID:</strong> ${booking_id}</p>
          <p><strong>Transaction ID:</strong> ${trx_id}</p>
          <p style="margin-top: 30px;">
            <a href="http://localhost:4200/" style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Return to Turf Site</a>
          </p>
        </div>
      `);
    }
  );
});


// Catch-all: serve Angular index.html for any non-API route
// This enables Angular client-side routing to work correctly
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
