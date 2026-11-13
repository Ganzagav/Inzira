import crypto from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const scrypt = promisify(crypto.scrypt);
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- passwords (scrypt, no native dependency) ----
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const key = await scrypt(pw, salt, 64);
  const a = Buffer.from(hash, 'hex');
  return a.length === key.length && crypto.timingSafeEqual(a, key);
}
export const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

// ---- tokens ----
const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET missing or too short (use: openssl rand -hex 32)');
  return s;
};
export const signToken = (u) => jwt.sign({ sub: u.id, role: u.role }, secret(), { expiresIn: '8h' });

async function userFromRequest(req) {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  let p;
  try { p = jwt.verify(h.slice(7), secret()); } catch { return null; }
  const q = await query('SELECT id, username, full_name, station, role, active FROM users WHERE id = $1', [p.sub]);
  const u = q.rows[0];
  return u && u.active ? u : null; // deactivated accounts lose access immediately
}

export const requireAuth = (...roles) => wrap(async (req, res, next) => {
  const u = await userFromRequest(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'forbidden' });
  req.user = u; next();
});

// ---- device keys (ESP32) ----
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newDeviceKey = () => `inz_${crypto.randomBytes(24).toString('hex')}`;

async function deviceFromRequest(req) {
  const k = req.get('x-api-key');
  if (!k) return null;
  const q = await query('SELECT id, name, type FROM devices WHERE key_hash = $1 AND active', [sha256(k)]);
  const d = q.rows[0];
  if (d) query('UPDATE devices SET last_seen = now() WHERE id = $1', [d.id]).catch(() => {});
  return d || null;
}
export const requireDevice = (...types) => wrap(async (req, res, next) => {
  const d = await deviceFromRequest(req);
  if (!d || (types.length && !types.includes(d.type))) return res.status(401).json({ error: 'invalid_api_key' });
  req.device = d; next();
});

// Officers (logged-in) or police-post devices may report incidents.
export const requireReporter = wrap(async (req, res, next) => {
  const u = await userFromRequest(req);
  if (u) { req.actor = { name: u.full_name, ref: `user:${u.id}`, role: u.role }; return next(); }
  const d = await deviceFromRequest(req);
  if (d && d.type === 'police_post') { req.actor = { name: `Post ${d.name}`, ref: `device:${d.id}`, role: 'device' }; return next(); }
  res.status(401).json({ error: 'unauthorized' });
});

export const hashAnon = (id) => sha256(`${process.env.PROBE_SALT || 'salt'}:${id}`).slice(0, 16);

export const audit = (actor, action, detail = {}) =>
  query('INSERT INTO audit_log (actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch((e) => console.warn('[audit]', e.message));
