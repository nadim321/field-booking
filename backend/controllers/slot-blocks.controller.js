const db = require('../database');

exports.create = (req, res) => {
  const { slot_ids, start_date, end_date, reason } = req.body;

  if (!slot_ids || !Array.isArray(slot_ids) || slot_ids.length === 0) {
    return res.status(400).json({ message: 'slot_ids must be a non-empty array' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ message: 'start_date and end_date are required (YYYY-MM-DD)' });
  }

  const start = new Date(start_date + 'T00:00:00Z');
  const end = new Date(end_date + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  if (end < start) {
    return res.status(400).json({ message: 'end_date must be on or after start_date' });
  }

  // Build the full set of (slot_id, date) pairs to insert
  const rows = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    slot_ids.forEach(slotId => rows.push([slotId, dateStr, reason || null]));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  if (rows.length === 0) {
    return res.status(400).json({ message: 'No slot/date combinations to block' });
  }

  // INSERT IGNORE skips pairs that already exist (idempotent)
  const placeholders = rows.map(() => '(?, ?, ?)').join(', ');
  const params = rows.flat();

  db.run(
    `INSERT IGNORE INTO slot_blocks (slot_id, block_date, reason) VALUES ${placeholders}`,
    params,
    function (err) {
      if (err) {
        return res.fail(err);
      }
      res.json({
        message: `Blocked ${this.changes} slot/date combination(s)`,
        blocked: this.changes,
        skipped: rows.length - this.changes
      });
    }
  );
};

exports.list = (req, res) => {
  const { start_date, end_date, slot_id } = req.query;

  let conditions = [];
  let params = [];

  if (start_date) {
    conditions.push('sb.block_date >= ?');
    params.push(start_date);
  }
  if (end_date) {
    conditions.push('sb.block_date <= ?');
    params.push(end_date);
  }
  if (slot_id) {
    conditions.push('sb.slot_id = ?');
    params.push(slot_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  db.all(
    `SELECT sb.id, sb.slot_id, sb.block_date, sb.reason, sb.created_at,
            s.start_time, s.end_time, s.price
     FROM slot_blocks sb
     JOIN slots s ON sb.slot_id = s.id
     ${where}
     ORDER BY sb.block_date ASC, TIME(s.start_time) ASC`,
    params,
    (err, rows) => {
      if (err) {
        return res.fail(err);
      }
      res.json(rows);
    }
  );
};

exports.remove = (req, res) => {
  const { slot_ids, start_date, end_date } = req.body;

  if (!slot_ids || !Array.isArray(slot_ids) || slot_ids.length === 0) {
    return res.status(400).json({ message: 'slot_ids must be a non-empty array' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ message: 'start_date and end_date are required' });
  }

  const placeholders = slot_ids.map(() => '?').join(', ');
  db.run(
    `DELETE FROM slot_blocks WHERE slot_id IN (${placeholders}) AND block_date >= ? AND block_date <= ?`,
    [...slot_ids, start_date, end_date],
    function (err) {
      if (err) {
        return res.fail(err);
      }
      res.json({ message: `Removed ${this.changes} block(s)`, removed: this.changes });
    }
  );
};
