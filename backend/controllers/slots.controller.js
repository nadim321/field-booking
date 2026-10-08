const db = require('../database');
const { isValidCategory, categoryLabel } = require('../constants/slot-categories');

exports.list = (req, res) => {
  db.all('SELECT * FROM slots ORDER BY TIME(start_time) ASC', [], (err, rows) => {
    if (err) {
      return res.fail(err);
    }
    res.json(rows);
  });
};

exports.create = (req, res) => {
  const { start_time, end_time, price, is_active, category } = req.body;

  if (!start_time || !end_time || price === undefined) {
    return res.status(400).json({ message: 'Required fields: start_time, end_time, price' });
  }

  // category is optional (NULL = "Uncategorized"), but if provided it
  // must be one of the known category IDs. Category is always set
  // manually by the admin -- it is never auto-derived from start_time.
  if (category !== undefined && category !== null && !isValidCategory(category)) {
    return res.status(400).json({ message: 'Invalid category value' });
  }

  db.run(
    'INSERT INTO slots (start_time, end_time, price, is_active, category) VALUES (?, ?, ?, ?, ?)',
    [start_time, end_time, price, is_active !== undefined ? is_active : 1, category ?? null],
    function (err) {
      if (err) {
        return res.fail(err);
      }
      res.status(201).json({
        message: 'Slot template created successfully',
        slot_id: this.lastID
      });
    }
  );
};

exports.update = (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, price, is_active, category } = req.body;

  // category is optional. If provided and not null, it must be valid.
  // Note: COALESCE(?, category) below means passing `null` explicitly
  // would NOT clear an existing category (COALESCE skips to the existing
  // column value on a NULL parameter) -- to genuinely clear a category
  // back to "Uncategorized", the frontend sends category_clear: true
  // instead, handled as a separate explicit UPDATE below.
  if (category !== undefined && category !== null && !isValidCategory(category)) {
    return res.status(400).json({ message: 'Invalid category value' });
  }

  const { category_clear } = req.body;

  db.run(
    `UPDATE slots 
     SET start_time = COALESCE(?, start_time), 
         end_time = COALESCE(?, end_time), 
         price = COALESCE(?, price), 
         is_active = COALESCE(?, is_active),
         category = ${category_clear ? 'NULL' : 'COALESCE(?, category)'}
     WHERE id = ?`,
    category_clear
      ? [start_time, end_time, price, is_active, id]
      : [start_time, end_time, price, is_active, category, id],
    function (err) {
      if (err) {
        return res.fail(err);
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Slot configuration not found' });
      }
      res.json({ message: 'Slot configuration updated successfully' });
    }
  );
};

exports.remove = (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM slots WHERE id = ?', [id], function (err) {
    if (err) {
      return res.fail(err);
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Slot configuration not found' });
    }
    res.json({ message: 'Slot configuration deleted successfully' });
  });
};
