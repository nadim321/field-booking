const bcrypt = require('bcryptjs');
const db = require('../database');

function usernameFrom(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim();
  return username && username.length <= 255 ? username : null;
}

function validPassword(value, optional = false) {
  if (optional && (value === undefined || value === '')) return true;
  return typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;
}

function isDuplicateUsername(error) {
  return error.code === 'ER_DUP_ENTRY' || error.code === '23505';
}

exports.list = async (req, res) => {
  const connection = await db.promiseConnection();
  try {
    const [rows] = await connection.query("SELECT id,username FROM users WHERE role='admin' ORDER BY username,id");
    res.set('Cache-Control', 'no-store').json(rows);
  } finally {
    connection.release();
  }
};

exports.create = async (req, res) => {
  const username = usernameFrom(req.body?.username);
  const password = req.body?.password;
  if (!username) return res.status(400).json({ message: 'Username is required and must be at most 255 characters' });
  if (!validPassword(password)) return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes' });

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await db.promiseConnection();
  try {
    const [result] = await connection.query("INSERT INTO users (username,password,role) VALUES (?,?,'admin')", [username, passwordHash]);
    res.status(201).json({ id: result.insertId, username });
  } catch (error) {
    if (isDuplicateUsername(error)) return res.status(409).json({ message: 'That username is already in use' });
    throw error;
  } finally {
    connection.release();
  }
};

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const username = usernameFrom(req.body?.username);
  const password = req.body?.password;
  const changePassword = password !== undefined && password !== '';
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid admin ID' });
  if (!username) return res.status(400).json({ message: 'Username is required and must be at most 255 characters' });
  if (!validPassword(password, true)) return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes' });

  const connection = await db.promiseConnection();
  try {
    const [existingRows] = await connection.query("SELECT id FROM users WHERE id=? AND role='admin'", [id]);
    if (!existingRows.length) return res.status(404).json({ message: 'Admin account not found' });
    const [conflicts] = await connection.query('SELECT id FROM users WHERE username=? AND id<>?', [username, id]);
    if (conflicts.length) return res.status(409).json({ message: 'That username is already in use' });

    const passwordHash = changePassword ? await bcrypt.hash(password, 12) : null;
    await connection.query(
      `UPDATE users SET username=?,
       password=COALESCE(?,password),
       auth_version=auth_version+?
       WHERE id=? AND role='admin'`,
      [username, passwordHash, changePassword ? 1 : 0, id]
    );
    res.json({ id, username, reauthentication_required: changePassword && id === Number(req.user.id) });
  } catch (error) {
    if (isDuplicateUsername(error)) return res.status(409).json({ message: 'That username is already in use' });
    throw error;
  } finally {
    connection.release();
  }
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid admin ID' });
  const connection = await db.promiseConnection();
  try {
    const [result] = await connection.query("DELETE FROM users WHERE id=? AND role='admin'", [id]);
    if (result.affectedRows !== 1) return res.status(404).json({ message: 'Admin account not found' });
    res.json({ deleted_id: id });
  } finally {
    connection.release();
  }
};
