const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const customerAuth = require('./customer-auth');
const { bookingPhoneOtpRequired } = require('../services/customers/customer-auth.service');

module.exports = (req, res, next) => {
  if (bookingPhoneOtpRequired()) return customerAuth(req, res, next);
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      if (decoded.role === 'customer' && Number.isSafeInteger(Number(decoded.id)) && decoded.phone_e164) {
        req.customer = { id: Number(decoded.id), phone: decoded.phone_e164 };
      }
    } catch { /* Optional sessions do not block bookings while verification is disabled. */ }
  }
  next();
};
