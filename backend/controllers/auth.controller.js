const db = require('../database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret: JWT_SECRET } = require('../config/env');
const { demoAdminLoginEnabled, DEMO_ADMIN_USERNAME, DEMO_ADMIN_PASSWORD } = require('../services/auth/demo-admin');

exports.demoLoginConfig = (req, res) => {
  const enabled = demoAdminLoginEnabled();
  res.set('Cache-Control', 'no-store').json({
    enabled,
    credentials: enabled ? { username: DEMO_ADMIN_USERNAME, password: DEMO_ADMIN_PASSWORD } : null
  });
};

exports.login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.fail(err);
    }

    if (!user || (!['admin', 'owner', 'manager', 'staff'].includes(user.role) && !(user.role === 'demo_admin' && demoAdminLoginEnabled()))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, auth_version: Number(user.auth_version || 0) },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful',
      token,
      admin: { id: user.id, username: user.username }
    });
  });
};

exports.changePassword = async (req, res) => {
  if (req.user.role === 'demo_admin') {
    return res.status(403).json({ message: 'Demo admin accounts cannot change passwords' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }
  if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ message: 'New password must be at least 8 characters and no more than 72 bytes' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ message: 'New password must be different from the current password' });
  }

  const connection = await db.promiseConnection();
  try {
    const [rows] = await connection.query("SELECT password,auth_version FROM users WHERE id=? AND role IN ('admin','owner','manager','staff')", [req.user.id]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const [result] = await connection.query(
      'UPDATE users SET password=?,auth_version=auth_version+1 WHERE id=? AND auth_version=?',
      [passwordHash, req.user.id, Number(user.auth_version || 0)]
    );
    if (result.affectedRows !== 1) {
      return res.status(409).json({ message: 'Password changed in another session. Please sign in again.' });
    }

    res.json({ message: 'Password changed. Please sign in again.' });
  } finally {
    connection.release();
  }
};
