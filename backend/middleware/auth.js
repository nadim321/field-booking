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
    } else if (!['admin', 'owner', 'manager', 'staff'].includes(decoded.role)) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    db.get('SELECT auth_version FROM users WHERE id=?', [decoded.id], (lookupError, user) => {
      if (lookupError) return res.fail(lookupError);
      const tokenVersion = Number.isInteger(decoded.auth_version) ? decoded.auth_version : 0;
      if (!user || tokenVersion !== Number(user.auth_version)) {
        return res.status(401).json({ code: 'ADMIN_SESSION_REVOKED', message: 'Admin session was revoked. Please sign in again.' });
      }
      req.user = decoded;
      if (decoded.role === 'staff' && !staffCanWrite(req)) {
        return res.status(403).json({ message: 'Staff access is limited to booking status and payment collection tasks' });
      }
      if (decoded.role === 'staff' && req.path.startsWith('/api/admin/audit-log')) return res.status(403).json({ message: 'Owner or manager access required' });
      if (decoded.role === 'staff' && req.path.startsWith('/api/admin/cancellation-requests')) return res.status(403).json({ message: 'Owner or manager access required' });
      if (decoded.role === 'staff' && ['/api/admin/settings', '/api/admin/admins'].some(prefix => req.path.startsWith(prefix))) return res.status(403).json({ message: 'Owner or manager access required' });
      if (['admin', 'owner'].includes(decoded.role) || decoded.role === 'demo_admin') return next();
      if (decoded.role === 'manager' && ['/api/admin/admins', '/api/admin/auth'].some(prefix => req.path.startsWith(prefix))) {
        return res.status(403).json({ message: 'Owner access required' });
      }
      next();
    });
  });
};

function staffCanWrite(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (req.method === 'POST' && req.path === '/api/auth/change-password') return true;
  if (req.method === 'POST' && /^\/api\/admin\/bookings\/\d+\/collections$/.test(req.path)) return true;
  if (req.method === 'PUT' && /^\/api\/admin\/bookings\/\d+$/.test(req.path)) {
    return req.body && Object.keys(req.body).length === 1 && ['pending', 'approved'].includes(req.body.status);
  }
  return false;
}
module.exports.staffCanWrite = staffCanWrite;
