const db = require('../database');

exports.cleanup = (req, res) => {
  db.run('DELETE FROM slot_holds WHERE expires_at <= CURRENT_TIMESTAMP', [], function (err) {
    if (err) {
      return res.fail(err);
    }
    res.json({ message: 'Expired holds cleaned', rowsDeleted: this.changes });
  });
};

exports.summary = async (req, res) => {
  const stats = await require('../services/bookings/report.service').summary();
  res.set('Cache-Control', 'no-store').json(stats);
};
