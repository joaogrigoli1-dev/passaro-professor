const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'passaro_jwt_secret_change_in_prod';
const JWT_EXPIRES = '8h';

function generateToken() {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function checkPassword(plain) {
  const row = db.prepare(`SELECT value FROM site_config WHERE key='admin_password_hash'`).get();
  if (!row) return false;
  return bcrypt.compareSync(plain, row.value);
}

function setPassword(plain) {
  const hash = bcrypt.hashSync(plain, 10);
  db.prepare(`INSERT INTO site_config(key,value) VALUES('admin_password_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(hash);
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Token inválido ou expirado' });
  req.admin = payload;
  next();
}

module.exports = { generateToken, verifyToken, checkPassword, setPassword, requireAuth };
