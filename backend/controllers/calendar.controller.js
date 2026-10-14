const calendar = require('../services/bookings/calendar.service');

exports.read = async (req, res) => {
  const result = await calendar.read(req.query.start_date, req.query.end_date);
  res.set('Cache-Control', 'no-store').json(result);
};
