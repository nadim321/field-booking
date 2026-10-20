const jwt = require('jsonwebtoken');
const db = require('../database');
const { jwtSecret } = require('../config/env');
const { demoAdminLoginEnabled } = require('../services/auth/demo-admin');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization header is missing' });
  }

  // Expecting format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ message: 'Token format must be Bearer <token>' });
  }

  const token = parts[1];

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    if (decoded.role === 'demo_admin') {
      if (!demoAdminLoginEnabled()) return res.status(403).json({ message: 'Demo admin access is disabled' });
      if (!['GET', 'HEAD'].includes(req.method)) return res.status(403).json({ message: 'Demo admin access is read-only' });
    } else if (decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    db.get('SELECT auth_version FROM users WHERE id=?', [decoded.id], (lookupError, user) => {
      if (lookupError) return res.fail(lookupError);
      const tokenVersion = Number.isInteger(decoded.auth_version) ? decoded.auth_version : 0;
      if (!user || tokenVersion !== Number(user.auth_version)) {
        return res.status(401).json({ code: 'ADMIN_SESSION_REVOKED', message: 'Admin session was revoked. Please sign in again.' });
      }
      req.user = decoded;
      next();
    });
  });
};
