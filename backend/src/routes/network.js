import { Router } from 'express';
import { getGraph } from '../graph.js';
import { abnormalSegments } from '../graphcore.js';
import { listGroups } from '../incidents.js';
import { query } from '../db.js';
import { wrap } from '../middleware.js';

const r = Router();

// Is the road network imported? What area does it cover?
r.get('/meta', wrap(async (_req, res) => {
  const g = await getGraph();
  res.json({ edges: g.edges.length, nodes: g.nodes.size, bbox: g.bbox, imported: g.edges.length > 0 });
}));

// Autocomplete over imported OSM places
r.get('/places/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  const rows = q
    ? (await query(
        `SELECT id, name, kind, lat, lng FROM places
         WHERE lower(name) LIKE $1 OR lower(name) LIKE $2
         ORDER BY (lower(name) LIKE $1) DESC, length(name) LIMIT 8`, [`${q}%`, `%${q}%`])).rows
    : (await query(
        `SELECT id, name, kind, lat, lng FROM places
         WHERE kind IN ('suburb','neighbourhood','quarter','town') ORDER BY name LIMIT 30`)).rows;
  res.json(rows);
}));

// Name for a clicked point ("near Kimironko")
r.get('/places/near', wrap(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat_lng_required' });
  const q = await query(
    `SELECT name, kind, lat, lng FROM places ORDER BY (lat-$1)^2 + (lng-$2)^2 LIMIT 1`, [lat, lng]);
  res.json(q.rows[0] || null);
}));

// Live layer for the public map: only abnormal roads + active incidents (keeps the map clean)
r.get('/network', wrap(async (_req, res) => {
  const g = await getGraph();
  const segments = abnormalSegments(g);
  const groups = (await listGroups('active')).filter((x) => x.type !== 'clear');
  const incidents = groups.map((x) => ({
    group_id: x.group_id, type: x.type, level: x.level, road: x.road_name, note: x.note,
    until: x.ends_at, lat: x.lat, lng: x.lng,
  }));
  const alerts = groups
    .filter((x) => x.type !== 'congestion' || x.level >= 3)
    .map((x) => ({
      type: x.type === 'closure' ? 'closed' : x.type === 'congestion' ? 'heavy_traffic' : x.type,
      road: x.road_name || '', reason: x.note, until: x.ends_at, lat: x.lat, lng: x.lng,
    }));
  // heavy traffic detected from vehicles (not police), grouped by road name
  const veh = new Map();
  for (const s of segments) if (s.source === 'vehicles' && s.level >= 3 && !veh.has(s.name)) veh.set(s.name, s);
  for (const [name, s] of veh) alerts.push({ type: 'heavy_traffic', road: name, reason: null, until: null, lat: s.line[0][0], lng: s.line[0][1] });
  res.json({ updated_at: new Date().toISOString(), segments, incidents, alerts: alerts.slice(0, 25) });
}));

r.get('/trips/stats', wrap(async (_req, res) => {
  const q = await query(`
    SELECT mode, COUNT(*)::int AS trips,
           ROUND(AVG(estimated_s))::int AS avg_estimated_s, ROUND(AVG(actual_s))::int AS avg_actual_s,
           ROUND(AVG(ABS(actual_s - estimated_s)::numeric / NULLIF(actual_s,0) * 100), 1) AS avg_error_pct
    FROM trips GROUP BY mode ORDER BY mode`);
  res.json(q.rows);
}));

export default r;
