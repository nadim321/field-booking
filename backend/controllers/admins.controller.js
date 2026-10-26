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
const roles = new Set(['owner', 'manager', 'staff']);
function validRole(value) { return roles.has(value) ? value : null; }

function isDuplicateUsername(error) {
  return error.code === 'ER_DUP_ENTRY' || error.code === '23505';
}

exports.list = async (req, res) => {
  const connection = await db.promiseConnection();
  try {
    const [rows] = await connection.query("SELECT id,username,CASE WHEN role='admin' THEN 'owner' ELSE role END AS role FROM users WHERE role IN ('admin','owner','manager','staff') ORDER BY username,id");
    res.set('Cache-Control', 'no-store').json(rows);
  } finally {
    connection.release();
  }
};

exports.create = async (req, res) => {
  const username = usernameFrom(req.body?.username);
  const password = req.body?.password;
  const role = validRole(req.body?.role || 'staff');
  if (!username) return res.status(400).json({ message: 'Username is required and must be at most 255 characters' });
  if (!validPassword(password)) return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes' });
  if (!role) return res.status(400).json({ message: 'Role must be owner, manager, or staff' });

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await db.promiseConnection();
  try {
    const [result] = await connection.query('INSERT INTO users (username,password,role) VALUES (?,?,?)', [username, passwordHash, role]);
    res.locals.auditResourceId = result.insertId;
    res.status(201).json({ id: result.insertId, username, role });
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
  const role = req.body?.role === undefined ? undefined : validRole(req.body.role);
  const changePassword = password !== undefined && password !== '';
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid admin ID' });
  if (!username) return res.status(400).json({ message: 'Username is required and must be at most 255 characters' });
  if (!validPassword(password, true)) return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes' });
  if (req.body?.role !== undefined && !role) return res.status(400).json({ message: 'Role must be owner, manager, or staff' });

  const connection = await db.promiseConnection();
  try {
    const [existingRows] = await connection.query("SELECT id,role FROM users WHERE id=? AND role IN ('admin','owner','manager','staff')", [id]);
    if (!existingRows.length) return res.status(404).json({ message: 'Admin account not found' });
    if (id === Number(req.user.id) && role && role !== (existingRows[0].role === 'admin' ? 'owner' : existingRows[0].role)) return res.status(400).json({ message: 'You cannot change your own role' });
    const [conflicts] = await connection.query('SELECT id FROM users WHERE username=? AND id<>?', [username, id]);
    if (conflicts.length) return res.status(409).json({ message: 'That username is already in use' });

    const passwordHash = changePassword ? await bcrypt.hash(password, 12) : null;
    await connection.query(
      `UPDATE users SET username=?, role=COALESCE(?,CASE WHEN role='admin' THEN 'owner' ELSE role END),
       password=COALESCE(?,password),
       auth_version=auth_version+?
       WHERE id=? AND role IN ('admin','owner','manager','staff')`,
      [username, role || null, passwordHash, (changePassword || role) ? 1 : 0, id]
    );
    res.json({ id, username, role: role || (existingRows[0].role === 'admin' ? 'owner' : existingRows[0].role), reauthentication_required: (changePassword || role) && id === Number(req.user.id) });
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
    if (id === Number(req.user.id)) return res.status(400).json({ message: 'You cannot delete your own account' });
    const [result] = await connection.query("DELETE FROM users WHERE id=? AND role IN ('admin','owner','manager','staff')", [id]);
    if (result.affectedRows !== 1) return res.status(404).json({ message: 'Admin account not found' });
    res.json({ deleted_id: id });
  } finally {
    connection.release();
  }
};
