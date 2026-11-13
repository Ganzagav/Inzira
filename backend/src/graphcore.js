// In-memory road graph + live conditions. Pure (no DB) so it can be tested offline.
import { haversine, distToPolyline } from './geo.js';

const CELL = 0.005; // ~550 m grid cells for spatial lookups
const cellOf = (lat, lng) => [Math.floor(lat / CELL), Math.floor(lng / CELL)];
const key = (cy, cx) => `${cy},${cx}`;

export const levelFromRatio = (r) => (r > 0.8 ? 0 : r > 0.6 ? 1 : r > 0.4 ? 2 : r > 0.2 ? 3 : 4);

export function resetEdge(e) {
  e.level = 0; e.source = 'none'; e.blocked = false; e.status = 'open';
  e.block_kind = null; e.block_reason = null; e.block_until = null; e.note = null; e.probe_speed = null;
}

export function buildStatic(nodeRows, edgeRows) {
  const nodes = new Map(), nodeGrid = new Map();
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const r of nodeRows) {
    const n = { id: Number(r.id), lat: r.lat, lng: r.lng };
    nodes.set(n.id, n);
    const [cy, cx] = cellOf(n.lat, n.lng), k = key(cy, cx);
    if (!nodeGrid.has(k)) nodeGrid.set(k, []);
    nodeGrid.get(k).push(n);
    minLat = Math.min(minLat, n.lat); maxLat = Math.max(maxLat, n.lat);
    minLng = Math.min(minLng, n.lng); maxLng = Math.max(maxLng, n.lng);
  }
  const edges = [], edgeById = new Map(), edgeGrid = new Map(), byGroup = new Map();
  const adj = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const r of edgeRows) {
    const e = {
      id: r.id, way_id: Number(r.way_id), name: r.name || '', highway: r.highway,
      from_node: Number(r.from_node), to_node: Number(r.to_node), length_m: r.length_m,
      road_type: r.road_type, is_major: r.is_major, free_flow_kmh: r.free_flow_kmh,
      oneway: r.oneway, geom: r.geom,
    };
    const n = e.geom.length;
    e.mid = n % 2 ? e.geom[(n - 1) / 2]
      : [(e.geom[n / 2 - 1][0] + e.geom[n / 2][0]) / 2, (e.geom[n / 2 - 1][1] + e.geom[n / 2][1]) / 2];
    e.group = e.name ? `n:${e.name.toLowerCase()}` : `w:${e.way_id}`;
    resetEdge(e);
    if (!adj.has(e.from_node) || !adj.has(e.to_node)) continue;
    edges.push(e); edgeById.set(e.id, e);
    adj.get(e.from_node).push({ edge: e, to: e.to_node });
    if (!e.oneway) adj.get(e.to_node).push({ edge: e, to: e.from_node });
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group).push(e);
    const cells = new Set(e.geom.map(([la, ln]) => key(...cellOf(la, ln))));
    for (const k of cells) { if (!edgeGrid.has(k)) edgeGrid.set(k, []); edgeGrid.get(k).push(e); }
  }
  return {
    nodes, edges, edgeById, adj, nodeGrid, edgeGrid, byGroup, touched: new Set(),
    bbox: edges.length ? { south: minLat, west: minLng, north: maxLat, east: maxLng } : null,
  };
}

export function nearestNode(g, lat, lng, maxM = 3000) {
  const [cy, cx] = cellOf(lat, lng);
  let best = null, bd = Infinity;
  for (let r = 0; r <= 10; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const list = g.nodeGrid.get(key(cy + dy, cx + dx));
      if (!list) continue;
      for (const n of list) { const d = haversine({ lat, lng }, n); if (d < bd) { bd = d; best = n; } }
    }
    if (best && bd <= r * CELL * 111000 * 0.9) break;
  }
  return best && bd <= maxM ? { node: best, dist: bd } : null;
}

export function nearestEdge(g, lat, lng, maxM = 250, filter = null) {
  const [cy, cx] = cellOf(lat, lng);
  const seen = new Set();
  let best = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    for (const e of g.edgeGrid.get(key(cy + dy, cx + dx)) || []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (filter && !filter(e)) continue;
      const d = distToPolyline({ lat, lng }, e.geom);
      if (d < bd) { bd = d; best = e; }
    }
  }
  return best && bd <= maxM ? { edge: best, dist: bd } : null;
}

// All edges of the same road (by name, else OSM way) within radius of the clicked point.
export function selectEdges(g, lat, lng, radius = 400, hint = '') {
  const h = String(hint || '').toLowerCase();
  const near = nearestEdge(g, lat, lng, 250, h ? (e) => e.name.toLowerCase().includes(h) : null);
  if (!near) return null;
  const p = { lat, lng };
  const picked = (g.byGroup.get(near.edge.group) || [near.edge]).filter(
    (e) => e === near.edge || haversine(p, { lat: e.mid[0], lng: e.mid[1] }) <= radius);
  return { anchor: near.edge, edges: picked, name: near.edge.name, highway: near.edge.highway,
    length_m: Math.round(picked.reduce((s, e) => s + e.length_m, 0)) };
}

// probeRows: [{edge_id, avg_speed, vehicles}]; incRows ordered oldest -> newest.
export function applyLive(g, incRows, probeRows, minVehicles = 1) {
  for (const id of g.touched) { const e = g.edgeById.get(id); if (e) resetEdge(e); }
  g.touched.clear();
  const touch = (e) => { g.touched.add(e.id); return e; };

  for (const p of probeRows) {
    const e = g.edgeById.get(p.edge_id);
    if (!e || Number(p.vehicles) < minVehicles) continue;
    touch(e);
    e.level = levelFromRatio(Number(p.avg_speed) / e.free_flow_kmh);
    e.source = 'vehicles';
    e.probe_speed = Math.round(Number(p.avg_speed));
  }
  for (const r of incRows) {
    const e = g.edgeById.get(r.edge_id);
    if (!e) continue;
    touch(e);
    if (r.type === 'congestion' || r.type === 'accident') { e.level = r.level; e.source = 'police'; e.note = r.note; }
    else if (r.type === 'clear') { e.level = 0; e.source = 'police'; }
    else if (r.type === 'closure') { e.blocked = true; e.block_kind = r.cause; e.block_reason = r.note; e.block_until = r.ends_at; }
    else if (r.type === 'roadworks') { e.status = 'construction'; e.note = r.note || e.note; }
  }
}

// Only abnormal edges are sent to the map, so the public map stays clean.
export function abnormalSegments(g) {
  const out = [];
  for (const id of g.touched) {
    const e = g.edgeById.get(id);
    if (e && (e.level > 0 || e.blocked || e.status !== 'open')) {
      out.push({ id: e.id, name: e.name, line: e.geom, level: e.level, blocked: e.blocked,
        status: e.status, source: e.source, probe_speed: e.probe_speed });
    }
  }
  return out;
}
