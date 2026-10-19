const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

module.exports = (req, res, next) => {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ message: 'Customer login is required' });
  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (decoded.role !== 'customer' || !Number.isSafeInteger(Number(decoded.id)) || !decoded.phone_e164) {
      return res.status(403).json({ message: 'Customer access required' });
    }
    req.customer = { id: Number(decoded.id), phone: decoded.phone_e164 };
    next();
  } catch { res.status(401).json({ message: 'Customer login expired. Verify your phone again.' }); }
};
