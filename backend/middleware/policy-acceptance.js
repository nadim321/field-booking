const db = require('../database');
const { VERSION: cancellationPolicyVersion } = require('../services/bookings/cancellation-policy');

function requirePolicyAcceptance(req, res, next) {
  if (!db.cancellationReady) return res.status(503).json({ message: 'Booking maintenance in progress. Please retry shortly.' });
  if (req.body.policy_accepted !== true || req.body.policy_version !== cancellationPolicyVersion) {
    return res.status(400).json({ message: 'Please read and accept the current cancellation policy before booking.' });
  }
  next();
}
module.exports = requirePolicyAcceptance;
