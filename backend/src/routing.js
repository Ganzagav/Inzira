import { bearingPts, haversine } from './geo.js';
import { nearestNode } from './graphcore.js';

// ---- Cost model ------------------------------------------------------------
const SURFACE_SPEED = { tarmac: 1.0, stone: 0.7, dirt: 0.5 };
const SURFACE_COMFORT = { tarmac: 0, stone: 0.1, dirt: 0.25 };
const CONGESTION_SPEED = [1.0, 0.75, 0.5, 0.25, 0.1];
const FUEL_FACTOR = [1.0, 1.1, 1.3, 1.6, 2.0];
const FUEL_L_PER_KM = 0.085; // ~8.5 L/100 km (demo value)
const MAX_SPEED_MPS = 100 / 3.6; // free-flow is clamped to 100 km/h at import (keeps A* admissible)

export function edgeSpeedKmh(e) {
  let v = e.free_flow_kmh * SURFACE_SPEED[e.road_type] * CONGESTION_SPEED[e.level];
  if (e.status === 'construction') v *= 0.4; // roadworks: slow, one lane, flaggers
  return Math.max(v, 2);
}
export const edgeSeconds = (e) => e.length_m / (edgeSpeedKmh(e) / 3.6);

const fastestCost = (opts) => (e) =>
  edgeSeconds(e) * (1 + SURFACE_COMFORT[e.road_type]) * (opts.avoidUnpaved && e.road_type !== 'tarmac' ? 4 : 1);
const shortestCost = (e) => e.length_m;

// ---- A* with a binary heap -------------------------------------------------
class MinHeap {
  constructor() { this.h = []; }
  get size() { return this.h.length; }
  push(item) {
    const h = this.h; h.push(item);
    let i = h.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
  }
  pop() {
    const h = this.h, top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]]; i = m;
      }
    }
    return top;
  }
}

function search(g, src, dst, costFn, hScale) {
  const goal = g.nodes.get(dst);
  const h = (id) => haversine(g.nodes.get(id), goal) * hScale;
  const gScore = new Map([[src, 0]]), prev = new Map(), closed = new Set(), heap = new MinHeap();
  heap.push([h(src), src]);
  while (heap.size) {
    const [, u] = heap.pop();
    if (u === dst) break;
    if (closed.has(u)) continue;
    closed.add(u);
    const gu = gScore.get(u);
    for (const { edge, to } of g.adj.get(u) || []) {
      if (edge.blocked || closed.has(to)) continue;
      const ng = gu + costFn(edge);
      if (ng < (gScore.get(to) ?? Infinity)) { gScore.set(to, ng); prev.set(to, { from: u, edge }); heap.push([ng + h(to), to]); }
    }
  }
  if (src !== dst && !prev.has(dst)) return null;
  const legs = [];
  for (let cur = dst; cur !== src;) { const p = prev.get(cur); legs.unshift({ edge: p.edge, from: p.from, to: cur }); cur = p.from; }
  return legs;
}

// ---- Presenting a route ----------------------------------------------------
const orient = (e, from) => (e.from_node === from ? e.geom : e.geom.slice().reverse());

function summarize(legs, label) {
  let secs = 0, meters = 0, fuel = 0;
  const coords = [], groups = [];
  let prevEnd = null;
  for (const leg of legs) {
    const e = leg.edge, pts = orient(e, leg.from), s = edgeSeconds(e);
    secs += s; meters += e.length_m;
    fuel += (e.length_m / 1000) * FUEL_FACTOR[e.level] * FUEL_L_PER_KM;
    for (let i = coords.length ? 1 : 0; i < pts.length; i++) coords.push(pts[i]);
    const startB = bearingPts(pts[0], pts[1]), endB = bearingPts(pts[pts.length - 2], pts[pts.length - 1]);
    const last = groups[groups.length - 1];
    if (last && last.road === e.name) {
      last.distance_m += e.length_m; last.seconds += s; last.level = Math.max(last.level, e.level);
      last.construction ||= e.status === 'construction'; last.unpaved ||= e.road_type !== 'tarmac';
    } else {
      let turn = 'start';
      if (last) {
        const d = ((startB - prevEnd + 540) % 360) - 180;
        turn = Math.abs(d) < 20 ? 'straight' : Math.abs(d) > 150 ? 'uturn' : d > 0 ? 'right' : 'left';
      }
      groups.push({ road: e.name, turn, distance_m: e.length_m, seconds: s, level: e.level, start: pts[0],
        construction: e.status === 'construction', unpaved: e.road_type !== 'tarmac' });
    }
    prevEnd = endB;
  }
  const warnings = [], seen = new Set();
  const warn = (type, road) => { const k = `${type}|${road}`; if (!seen.has(k)) { seen.add(k); warnings.push({ type, road }); } };
  for (const s of groups) {
    if (s.construction) warn('construction', s.road);
    if (s.unpaved) warn('unpaved', s.road);
    if (s.level >= 3) warn('heavy_traffic', s.road);
  }
  return {
    label, distance_m: Math.round(meters), duration_s: Math.round(secs), fuel_l: Math.round(fuel * 100) / 100,
    coordinates: coords,
    steps: groups.map((s) => ({ road: s.road, turn: s.turn, distance_m: Math.round(s.distance_m),
      seconds: Math.round(s.seconds), level: s.level, start: s.start })),
    warnings,
    edge_ids: legs.map((l) => l.edge.id),
  };
}

export function snap(g, lat, lng) {
  const r = nearestNode(g, lat, lng, 3000);
  return r ? { node: r.node, snap_m: Math.round(r.dist) } : null;
}

export function computeRoutes(g, fromId, toId, opts = {}) {
  const fastLegs = search(g, fromId, toId, fastestCost(opts), 1 / MAX_SPEED_MPS);
  if (!fastLegs) return null;
  const shortLegs = search(g, fromId, toId, shortestCost, 1);
  const fastest = summarize(fastLegs, 'fastest');
  const shortest = summarize(shortLegs, 'shortest');

  // Alternative: penalise the fastest route's roads and search again.
  const used = new Set(fastest.edge_ids), base = fastestCost(opts);
  const altLegs = search(g, fromId, toId, (e) => base(e) * (used.has(e.id) ? 2.5 : 1), 1 / MAX_SPEED_MPS);
  let alternative = null;
  if (altLegs) {
    const alt = summarize(altLegs, 'alternative');
    // show it only if it is a genuinely different route that is not absurdly slower
    const overlap = alt.edge_ids.filter((id) => used.has(id)).length / alt.edge_ids.length;
    if (overlap < 0.8 && alt.duration_s < fastest.duration_s * 2) alternative = alt;
  }
  return {
    fastest, shortest, alternative,
    comparison: {
      time_saved_s: shortest.duration_s - fastest.duration_s,
      extra_distance_m: fastest.distance_m - shortest.distance_m,
      same_route: fastest.edge_ids.join() === shortest.edge_ids.join(),
    },
  };
}

// Evenly sampled flat [lat,lng,lat,lng...] for tiny devices
export function samplePoints(coords, max = 40) {
  const n = coords.length, out = [];
  const step = n <= max ? 1 : (n - 1) / (max - 1);
  for (let i = 0; i < Math.min(n, max); i++) {
    const [la, ln] = coords[Math.round(i * step)];
    out.push(Math.round(la * 1e5) / 1e5, Math.round(ln * 1e5) / 1e5);
  }
  return out;
}
