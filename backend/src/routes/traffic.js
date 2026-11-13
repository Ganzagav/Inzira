import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { getGraph, invalidateLive } from '../graph.js';
import { nearestEdge, selectEdges } from '../graphcore.js';
import { listGroups } from '../incidents.js';
import { requireAuth, requireReporter, requireDevice, wrap, hashAnon, audit } from '../middleware.js';

const r = Router();
const TYPES = ['congestion', 'accident', 'clear', 'closure', 'roadworks'];
const CAUSES = ['event', 'security', 'construction', 'accident', 'other'];

// Preview which road segments a report would cover (police portal map)
r.get('/roads/select', requireAuth('officer', 'admin'), wrap(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const radius = Math.min(Math.max(Number(req.query.radius_m) || 400, 50), 5000);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat_lng_required' });
  const g = await getGraph();
  if (!g.edges.length) return res.status(503).json({ error: 'network_not_imported' });
  const sel = selectEdges(g, lat, lng, radius, req.query.road);
  if (!sel) return res.status(404).json({ error: 'no_road_near' });
  res.json({ name: sel.name, highway: sel.highway, count: sel.edges.length, length_m: sel.length_m,
    lines: sel.edges.slice(0, 500).map((e) => e.geom) });
}));

// Create an incident (officer login OR police-post device key)
r.post('/incidents', requireReporter, wrap(async (req, res) => {
  const b = req.body || {};
  const lat = Number(b.lat), lng = Number(b.lng), type = String(b.type || '');
  const radius = Math.min(Math.max(Math.round(Number(b.radius_m) || 400), 50), 5000);
  const minutes = Math.min(Math.max(Math.round(Number(b.minutes) || 30), 1), 60 * 24 * 14);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat_lng_required' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'invalid_type' });
  let level = 0;
  if (type === 'congestion') level = Number(b.level);
  if (type === 'accident') level = Number(b.level) || 3;
  if ((type === 'congestion' || type === 'accident') && !(Number.isInteger(level) && level >= 1 && level <= 4)) return res.status(400).json({ error: 'level_must_be_1_to_4' });
  const cause = type === 'closure' ? (CAUSES.includes(b.cause) ? b.cause : 'other') : null;

  const g = await getGraph();
  if (!g.edges.length) return res.status(503).json({ error: 'network_not_imported' });
  const sel = selectEdges(g, lat, lng, radius, b.road);
  if (!sel) return res.status(404).json({ error: 'no_road_near' });
  const group = crypto.randomUUID();
  const note = b.note ? String(b.note).slice(0, 200) : null;
  const q = await query(
    `INSERT INTO incidents (group_id, edge_id, type, cause, level, note, road_name, lat, lng, radius_m, created_by, created_ref, ends_at)
     SELECT $1::uuid, unnest($2::int[]), $3::text, $4::text, $5::smallint, $6::text, $7::text, $8::float8, $9::float8,
            $10::int, $11::text, $12::text, now() + ($13::text || ' minutes')::interval
     RETURNING ends_at`,
    [group, sel.edges.map((e) => e.id), type, cause, level, note, sel.name || sel.highway, lat, lng, radius, req.actor.name, req.actor.ref, String(minutes)]);
  invalidateLive();
  audit(req.actor.ref, 'incident.create', { group, type, road: sel.name, edges: sel.edges.length, radius, minutes });
  res.status(201).json({ ok: true, group_id: group, road: sel.name, edges: sel.edges.length, length_m: sel.length_m, ends_at: q.rows[0].ends_at });
}));

// List (active | history) - officers only
r.get('/incidents', requireAuth('officer', 'admin'), wrap(async (req, res) => {
  res.json(await listGroups(req.query.status === 'history' ? 'history' : 'active'));
}));

// Cancel / clear early. Officers: own reports. Admins: any.
r.delete('/incidents/:group', requireAuth('officer', 'admin'), wrap(async (req, res) => {
  const group = req.params.group;
  if (!/^[0-9a-f-]{36}$/.test(group)) return res.status(400).json({ error: 'invalid_group' });
  const own = await query('SELECT created_ref FROM incidents WHERE group_id = $1 LIMIT 1', [group]);
  if (!own.rows.length) return res.status(404).json({ error: 'not_found' });
  if (req.user.role !== 'admin' && own.rows[0].created_ref !== `user:${req.user.id}`) return res.status(403).json({ error: 'not_yours' });
  await query('UPDATE incidents SET cancelled_at = now() WHERE group_id = $1 AND cancelled_at IS NULL', [group]);
  invalidateLive();
  audit(`user:${req.user.id}`, 'incident.cancel', { group });
  res.json({ ok: true });
}));

// ---- Vehicle probes ----------------------------------------------------------
async function storeProbe({ hash, src, lat, lng, speed, heading }) {
  const g = await getGraph();
  const near = nearestEdge(g, lat, lng, 60);   // map-match within 60 m
  await query(
    `INSERT INTO probes (device_hash, src, lat, lng, speed_kmh, heading, edge_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [hash, src, lat, lng, speed, heading, near ? near.edge.id : null]);
  invalidateLive();
  return near ? near.edge.name || near.edge.highway : null;
}
const validProbe = (b) => Number.isFinite(b.lat) && Number.isFinite(b.lng) && Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180 &&
  (b.speed_kmh == null || (b.speed_kmh >= 0 && b.speed_kmh <= 160));

r.post('/probes', requireDevice('vehicle'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!validProbe(b)) return res.status(400).json({ error: 'invalid_probe' });
  const road = await storeProbe({ hash: hashAnon(`device:${req.device.id}`), src: 'device', lat: b.lat, lng: b.lng, speed: b.speed_kmh ?? null, heading: b.heading ?? null });
  res.status(201).json({ ok: true, matched_road: road });
}));

// Opt-in sharing from the web app (anonymous session id, rate limited)
const publicProbeLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
r.post('/probes/public', publicProbeLimit, wrap(async (req, res) => {
  const b = req.body || {};
  if (!validProbe(b) || !b.session_id || String(b.session_id).length > 64) return res.status(400).json({ error: 'invalid_probe' });
  await storeProbe({ hash: hashAnon(`web:${b.session_id}`), src: 'public', lat: b.lat, lng: b.lng, speed: b.speed_kmh ?? null, heading: b.heading ?? null });
  res.status(201).json({ ok: true });
}));

r.get('/probes/recent', wrap(async (_req, res) => {
  const q = await query(`
    SELECT DISTINCT ON (device_hash) lat, lng, speed_kmh, heading FROM probes
    WHERE created_at > now() - interval '3 minutes' ORDER BY device_hash, created_at DESC`);
  res.json(q.rows);
}));

// ---- Evaluation: estimated vs actual trip time --------------------------------
r.post('/trips', requireDevice('vehicle'), wrap(async (req, res) => {
  const b = req.body || {};
  const est = Math.round(Number(b.estimated_s)), act = Math.round(Number(b.actual_s));
  if (!(est > 0) || !(act > 0)) return res.status(400).json({ error: 'estimated_s_and_actual_s_required' });
  const mode = ['fastest', 'shortest', 'alternative'].includes(b.mode) ? b.mode : 'other';
  await query(
    `INSERT INTO trips (device_hash, mode, from_label, to_label, estimated_s, actual_s, distance_m) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [hashAnon(`device:${req.device.id}`), mode, String(b.from_label || '').slice(0, 60), String(b.to_label || '').slice(0, 60), est, act, Math.round(Number(b.distance_m)) || null]);
  res.status(201).json({ ok: true });
}));

export default r;
