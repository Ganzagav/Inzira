// Pure functions: turn raw Overpass JSON into a routable graph. No database, easy to test.
import { polylineLength } from './geo.js';

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const DEFAULT_SPEED = { motorway: 80, trunk: 60, primary: 50, secondary: 45, tertiary: 40, unclassified: 30, residential: 25, living_street: 15 };
const UNPAVED_DIRT = /^(unpaved|dirt|ground|earth|sand|mud|grass)$/;
const UNPAVED_STONE = /^(gravel|fine_gravel|compacted|paving_stones|sett|cobblestone|unhewn_cobblestone|bricks|stone|pebblestone)$/;
const PAVED = /^(asphalt|paved|concrete|concrete:plates|concrete:lanes|chipseal)$/;

export function classify(tags) {
  const hw = String(tags.highway || '').replace('_link', '');
  const s = String(tags.surface || '');
  // Unknown surface => assume tarmac, so we never invent "unpaved" warnings.
  const road_type = UNPAVED_DIRT.test(s) ? 'dirt' : UNPAVED_STONE.test(s) ? 'stone' : PAVED.test(s) ? 'tarmac' : 'tarmac';
  let speed = parseInt(tags.maxspeed, 10);
  if (!Number.isFinite(speed)) speed = DEFAULT_SPEED[hw] ?? 30;
  speed = Math.min(100, Math.max(10, speed));            // routing relies on speed <= 100
  const ow = String(tags.oneway || '');
  const oneway = ['yes', 'true', '1', '-1'].includes(ow) || tags.junction === 'roundabout' || hw === 'motorway';
  return { highway: hw, road_type, free_flow_kmh: speed, is_major: MAJOR.has(hw), oneway, reverse: ow === '-1' };
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;

export function buildGraph(elements) {
  const pos = new Map(), ways = [];
  for (const el of elements) {
    if (el.type === 'node') pos.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.tags?.highway && el.nodes) ways.push(el);
  }
  const usable = ways.filter((w) => !['private', 'no'].includes(w.tags.access) && w.tags.area !== 'yes');

  // A node is an intersection if it is shared by ways or is a way end.
  const use = new Map();
  for (const w of usable) {
    const ids = w.nodes.filter((id) => pos.has(id));
    ids.forEach((id, i) => use.set(id, (use.get(id) || 0) + (i === 0 || i === ids.length - 1 ? 2 : 1)));
  }

  let edges = [];
  for (const w of usable) {
    const ids = w.nodes.filter((id) => pos.has(id));
    if (ids.length < 2) continue;
    const c = classify(w.tags);
    const name = w.tags.name || w.tags.ref || '';
    let start = 0;
    for (let i = 1; i < ids.length; i++) {
      if (use.get(ids[i]) >= 2 || i === ids.length - 1) {
        const seg = ids.slice(start, i + 1);
        start = i;
        if (seg.length < 2 || seg[0] === seg[seg.length - 1]) continue;
        let raw = seg.map((id) => pos.get(id));
        let from = seg[0], to = seg[seg.length - 1];
        if (c.reverse) { raw = raw.slice().reverse(); [from, to] = [to, from]; }
        const length = polylineLength(raw);
        if (length < 1) continue;
        edges.push({
          way_id: w.id, name, highway: c.highway, from_node: from, to_node: to,
          length_m: Math.round(length * 10) / 10, road_type: c.road_type, is_major: c.is_major,
          free_flow_kmh: c.free_flow_kmh, oneway: c.oneway, geom: raw.map(([a, b]) => [r5(a), r5(b)]),
        });
      }
    }
  }

  // Keep only the largest connected component so every snapped point can route.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const e of edges) for (const n of [e.from_node, e.to_node]) if (!parent.has(n)) parent.set(n, n);
  for (const e of edges) { const a = find(e.from_node), b = find(e.to_node); if (a !== b) parent.set(a, b); }
  const size = new Map();
  for (const n of parent.keys()) { const r = find(n); size.set(r, (size.get(r) || 0) + 1); }
  let bestRoot = null, bestSize = 0;
  for (const [r, s] of size) if (s > bestSize) { bestRoot = r; bestSize = s; }
  const total = edges.length;
  edges = edges.filter((e) => find(e.from_node) === bestRoot);

  const used = new Set();
  edges.forEach((e) => { used.add(e.from_node); used.add(e.to_node); });
  const nodes = [...used].map((id) => ({ id, lat: pos.get(id)[0], lng: pos.get(id)[1] }));
  return { nodes, edges, stats: { ways: usable.length, edgesBeforeFilter: total, edges: edges.length, nodes: nodes.length } };
}

export function extractPlaces(elements) {
  const out = [], seen = new Set();
  for (const el of elements) {
    const t = el.tags;
    if (!t?.name) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const kind = t.place || t.amenity || t.leisure || t.tourism || (t.shop ? 'mall' : t.aeroway ? 'terminal' : null);
    if (!kind) continue;
    const key = `${t.name.toLowerCase()}|${kind}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: t.name, kind, lat: r5(lat), lng: r5(lng) });
  }
  return out;
}
