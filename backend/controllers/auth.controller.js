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

    if (!user || (user.role !== 'admin' && !(user.role === 'demo_admin' && demoAdminLoginEnabled()))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
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
