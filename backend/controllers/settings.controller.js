const venue = require('../services/venue.service');
const { POLICY: cancellationPolicy } = require('../services/bookings/cancellation-policy');
exports.policy = (req, res) => res.json(cancellationPolicy);
exports.adminSettings = async (req, res) => res.set('Cache-Control', 'no-store').json(await venue.read());
exports.publicSettings = async (req, res) => res.set('Cache-Control', 'no-store').json({ ...await venue.read(), cancellation_policy: cancellationPolicy });
exports.update = async (req, res) => {
  await venue.update(req.body);
  res.json({ message: 'Settings updated successfully' });
};
