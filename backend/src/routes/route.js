import { Router } from 'express';
import { getGraph } from '../graph.js';
import { computeRoutes, snap, samplePoints } from '../routing.js';
import { wrap } from '../middleware.js';

const r = Router();
const num = (v) => (v === undefined || v === '' ? NaN : Number(v));
const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, '-');

async function solve(req, res) {
  const g = await getGraph();
  if (!g.edges.length) { res.status(503).json({ error: 'network_not_imported' }); return null; }
  const p = { fl: num(req.query.from_lat), fg: num(req.query.from_lng), tl: num(req.query.to_lat), tg: num(req.query.to_lng) };
  if (![p.fl, p.fg, p.tl, p.tg].every(Number.isFinite) || Math.abs(p.fl) > 90 || Math.abs(p.tl) > 90) {
    res.status(400).json({ error: 'from_lat_from_lng_to_lat_to_lng_required' }); return null;
  }
  const a = snap(g, p.fl, p.fg), b = snap(g, p.tl, p.tg);
  if (!a) { res.status(422).json({ error: 'outside_coverage', which: 'from' }); return null; }
  if (!b) { res.status(422).json({ error: 'outside_coverage', which: 'to' }); return null; }
  if (a.node.id === b.node.id) { res.status(400).json({ error: 'too_close' }); return null; }
  const opts = { avoidUnpaved: req.query.avoid_unpaved === '1' };
  const result = computeRoutes(g, a.node.id, b.node.id, opts);
  if (!result) { res.status(404).json({ error: 'no_route' }); return null; }
  return { a, b, result, opts };
}

r.get('/route', wrap(async (req, res) => {
  const out = await solve(req, res);
  if (!out) return;
  res.json({
    from: { lat: out.a.node.lat, lng: out.a.node.lng, snap_m: out.a.snap_m },
    to: { lat: out.b.node.lat, lng: out.b.node.lng, snap_m: out.b.snap_m },
    options: out.opts, ...out.result, generated_at: new Date().toISOString(),
  });
}));

// Compact ASCII answer for ESP32 / small displays. Add &pts=1 to get a sampled path (flat lat,lng list).
r.get('/route/lite', wrap(async (req, res) => {
  const out = await solve(req, res);
  if (!out) return;
  const { fastest, comparison } = out.result;
  const first = fastest.steps[0];
  const alert = ['heavy_traffic', 'construction', 'unpaved'].find((t) => fastest.warnings.some((w) => w.type === t)) || 'none';
  const body = {
    ok: true, eta_min: Math.max(1, Math.round(fastest.duration_s / 60)), eta_s: fastest.duration_s,
    km: Math.round(fastest.distance_m / 100) / 10, dist_m: fastest.distance_m, fuel_l: fastest.fuel_l,
    road: ascii(first?.road || '-').slice(0, 24), turn: fastest.steps[1]?.turn || 'straight',
    next_m: first?.distance_m || 0, alert, saved_min: Math.max(0, Math.round(comparison.time_saved_s / 60)),
  };
  if (req.query.pts === '1') body.pts = samplePoints(fastest.coordinates, 40);
  res.json(body);
}));

export default r;
