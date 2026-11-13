import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { invalidateLive, reloadStatic } from '../graph.js';
import { runImport, validBbox, DEFAULT_BBOX } from '../osmImport.js';
import { requireAuth, wrap, hashPassword, verifyPassword, DUMMY_HASH, signToken, newDeviceKey, sha256, audit } from '../middleware.js';

export const auth = Router();
export const admin = Router();

const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_attempts' } });
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, station: u.station, role: u.role });

auth.post('/login', loginLimit, wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const q = await query('SELECT * FROM users WHERE username = $1', [username]);
  const u = q.rows[0];
  const ok = await verifyPassword(password, u ? u.password_hash : DUMMY_HASH); // same work either way
  if (!u || !u.active || !ok) { audit(`login:${username.slice(0, 32)}`, 'login.fail'); return res.status(401).json({ error: 'invalid_credentials' }); }
  // Two separate portals: officers use /police/, admins use /admin/. (portal is optional for scripts)
  const portal = req.body?.portal;
  if ((portal === 'admin' && u.role !== 'admin') || (portal === 'police' && u.role !== 'officer')) {
    audit(`user:${u.id}`, 'login.wrong_portal', { portal });
    return res.status(403).json({ error: 'wrong_portal', use: u.role === 'admin' ? 'admin' : 'police' });
  }
  await query('UPDATE users SET last_login = now() WHERE id = $1', [u.id]);
  audit(`user:${u.id}`, `login.ok`, { portal: portal || null });
  res.json({ token: signToken(u), user: publicUser(u) });
}));

auth.get('/me', requireAuth(), (req, res) => res.json({ user: publicUser(req.user) }));

auth.post('/password', requireAuth(), wrap(async (req, res) => {
  const { current = '', next = '' } = req.body || {};
  if (String(next).length < 8) return res.status(400).json({ error: 'password_min_8' });
  const q = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(String(current), q.rows[0].password_hash))) return res.status(401).json({ error: 'invalid_credentials' });
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(String(next)), req.user.id]);
  audit(`user:${req.user.id}`, 'password.change');
  res.json({ ok: true });
}));

// ---- Admin: users ----
admin.use(requireAuth('admin'));

admin.get('/users', wrap(async (_req, res) => {
  const q = await query('SELECT id, username, full_name, station, role, active, created_at, last_login FROM users ORDER BY id');
  res.json(q.rows);
}));

admin.post('/users', wrap(async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'invalid_username' });
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'password_min_8' });
  if (!b.full_name) return res.status(400).json({ error: 'full_name_required' });
  const role = b.role === 'admin' ? 'admin' : 'officer';
  try {
    const q = await query(
      `INSERT INTO users (username, full_name, station, role, password_hash) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, username, full_name, station, role, active`,
      [username, String(b.full_name).slice(0, 80), String(b.station || '').slice(0, 80) || null, role, await hashPassword(String(b.password))]);
    audit(`user:${req.user.id}`, 'user.create', { username, role });
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
}));

admin.patch('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (id === req.user.id && (b.active === false || (b.role && b.role !== 'admin'))) return res.status(400).json({ error: 'cannot_lock_yourself_out' });
  if (b.password !== undefined && String(b.password).length < 8) return res.status(400).json({ error: 'password_min_8' });
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (typeof b.active === 'boolean') add('active', b.active);
  if (b.role === 'admin' || b.role === 'officer') add('role', b.role);
  if (b.full_name) add('full_name', String(b.full_name).slice(0, 80));
  if (b.station !== undefined) add('station', String(b.station).slice(0, 80) || null);
  if (b.password) add('password_hash', await hashPassword(String(b.password)));
  if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
  vals.push(id);
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  audit(`user:${req.user.id}`, 'user.update', { id, fields: Object.keys(b).filter((k) => k !== 'password') });
  res.json({ ok: true });
}));

// ---- Admin: devices ----
admin.get('/devices', wrap(async (_req, res) => {
  res.json((await query('SELECT id, name, type, active, last_seen, created_at FROM devices ORDER BY id')).rows);
}));

admin.post('/devices', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const type = req.body?.type === 'police_post' ? 'police_post' : 'vehicle';
  if (!/^[A-Za-z0-9 ._-]{2,40}$/.test(name)) return res.status(400).json({ error: 'invalid_name' });
  const key = newDeviceKey();
  try {
    const q = await query('INSERT INTO devices (name, type, key_hash) VALUES ($1,$2,$3) RETURNING id, name, type', [name, type, sha256(key)]);
    audit(`user:${req.user.id}`, 'device.create', { name, type });
    res.status(201).json({ ...q.rows[0], key }); // the key is shown ONCE
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'name_taken' });
    throw e;
  }
}));

admin.patch('/devices/:id', wrap(async (req, res) => {
  await query('UPDATE devices SET active = $1 WHERE id = $2', [Boolean(req.body?.active), Number(req.params.id)]);
  audit(`user:${req.user.id}`, 'device.update', { id: req.params.id, active: Boolean(req.body?.active) });
  res.json({ ok: true });
}));

admin.get('/audit', wrap(async (_req, res) => {
  res.json((await query('SELECT id, actor, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 60')).rows);
}));

// ---- Admin: import roads from OpenStreetMap (runs in the background, poll /import-status) ----
const job = { state: 'idle', log: [], started: null, finished: null, result: null, error: null };
admin.post('/import-osm', wrap(async (req, res) => {
  if (job.state === 'running') return res.status(409).json({ error: 'import_running' });
  const bbox = String(req.body?.bbox || DEFAULT_BBOX).trim();
  if (!validBbox(bbox)) return res.status(400).json({ error: 'invalid_bbox' });
  Object.assign(job, { state: 'running', log: [], started: new Date(), finished: null, result: null, error: null });
  const log = (m) => { job.log.push(`${new Date().toISOString().slice(11, 19)}  ${m}`); if (job.log.length > 200) job.log.shift(); };
  audit(`user:${req.user.id}`, 'network.import', { bbox, main_only: Boolean(req.body?.main_only) });
  runImport({ bbox, mainOnly: Boolean(req.body?.main_only), log })
    .then((r) => { job.result = r; job.state = 'done'; reloadStatic(); })
    .catch((e) => { job.error = e.message; job.state = 'error'; log(`ERROR: ${e.message}`); })
    .finally(() => { job.finished = new Date(); });
  res.status(202).json({ ok: true });
}));
admin.get('/import-status', (_req, res) => res.json({ ...job, default_bbox: DEFAULT_BBOX }));

admin.post('/reload-network', wrap(async (_req, res) => { invalidateLive(); res.json({ ok: true }); }));
