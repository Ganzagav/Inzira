// Offline self-test (no database, no network): npm test
import assert from 'node:assert/strict';
import { buildGraph, extractPlaces } from '../src/osm.js';
import { buildStatic, applyLive, nearestNode, selectEdges, abnormalSegments } from '../src/graphcore.js';
import { computeRoutes, snap, samplePoints } from '../src/routing.js';

// Tiny synthetic "Overpass" response: a primary road A-B with a gravel back road, plus a disconnected island.
const N = (id, lat, lon) => ({ type: 'node', id, lat, lon });
const el = [
  N(1, -1.940, 30.060), N(2, -1.940, 30.070), N(3, -1.940, 30.080), N(4, -1.940, 30.090), N(5, -1.940, 30.100),
  N(6, -1.945, 30.065), N(7, -1.945, 30.085), N(8, -1.900, 30.000), N(9, -1.901, 30.001),
  { type: 'way', id: 100, nodes: [1, 2, 3, 4, 5], tags: { highway: 'primary', name: 'KG 9 Ave' } },
  { type: 'way', id: 101, nodes: [1, 6, 7, 5], tags: { highway: 'residential', name: 'Back Rd', surface: 'gravel' } },
  { type: 'way', id: 102, nodes: [2, 6], tags: { highway: 'residential' } },          // links main <-> back road
  { type: 'way', id: 103, nodes: [8, 9], tags: { highway: 'residential' } },          // island: must be dropped
  { type: 'node', id: 900, lat: -1.94, lon: 30.07, tags: { name: 'Kimironko', place: 'suburb' } },
];

const { nodes, edges, stats } = buildGraph(el);
assert.equal(stats.edgesBeforeFilter - stats.edges, 1, 'island edge removed');
const g = buildStatic(nodes, edges.map((e, i) => ({ id: i + 1, ...e })));
assert.equal(g.edges.length, 5, "main splits at junctions only");
assert.equal(extractPlaces(el)[0].name, 'Kimironko');

const A = snap(g, -1.9401, 30.0601).node.id, B = snap(g, -1.9401, 30.0999).node.id;
assert.equal(A, 1); assert.equal(B, 5);
assert.equal(nearestNode(g, -1.9, 30.0, 500), null, 'island not snappable / out of range');

// 1) free flow -> main road is fastest
let r = computeRoutes(g, A, B);
const mainOnly = (route) => route.steps.every((s) => s.road === 'KG 9 Ave');
assert.ok(mainOnly(r.fastest), 'free flow: fastest uses KG 9 Ave');
console.log('free flow   :', Math.round(r.fastest.duration_s / 60), 'min,', (r.fastest.distance_m / 1000).toFixed(1), 'km');

// 2) police jam on KG 9 Ave -> reroute via back road
const sel = selectEdges(g, -1.9400, 30.0800, 5000);
assert.equal(sel.name, 'KG 9 Ave'); assert.equal(sel.edges.length, 2);
applyLive(g, sel.edges.map((e) => ({ edge_id: e.id, type: 'congestion', level: 4, note: 'jam' })), []);
r = computeRoutes(g, A, B);
assert.ok(r.fastest.steps.some((s) => s.road === 'Back Rd'), 'jam: fastest avoids KG 9 Ave');
assert.ok(mainOnly(r.shortest), 'shortest ignores traffic');
assert.ok(r.comparison.time_saved_s > 0);
console.log('jam         :', Math.round(r.fastest.duration_s / 60), 'min via', r.fastest.steps.map((s) => s.road || '(unnamed)').join(' > '),
  '| shortest would take', Math.round(r.shortest.duration_s / 60), 'min');
assert.ok(abnormalSegments(g).length === 2, 'only abnormal edges are sent to the map');
assert.ok(r.fastest.warnings.every((w) => w.type !== 'heavy_traffic' || w.road !== 'Back Rd'));

// 3) clear overrides, closure blocks
applyLive(g, [], []);
assert.equal(abnormalSegments(g).length, 0, 'live state fully reset');
applyLive(g, sel.edges.map((e) => ({ edge_id: e.id, type: 'closure', cause: 'event', note: 'BK Arena', ends_at: new Date() })), []);
r = computeRoutes(g, A, B);
assert.ok(r.fastest.steps.every((s) => s.road !== 'KG 9 Ave'), 'closed road never used');
const all = [...g.edges].map((e) => ({ edge_id: e.id, type: 'closure', cause: 'security' }));
applyLive(g, all, []);
assert.equal(computeRoutes(g, A, B), null, 'no route when everything is closed');

// 4) vehicle probes slow a road down, roadworks slow it too
applyLive(g, [], [{ edge_id: sel.edges[0].id, avg_speed: 5, vehicles: 3 }], 3);
assert.equal(g.edgeById.get(sel.edges[0].id).level, 4);
applyLive(g, [], [{ edge_id: sel.edges[0].id, avg_speed: 5, vehicles: 2 }], 3);
assert.equal(g.edgeById.get(sel.edges[0].id).level, 0, 'too few vehicles are ignored');

// 5) device helper
applyLive(g, [], []);
assert.ok(samplePoints(computeRoutes(g, A, B).fastest.coordinates, 5).length <= 10);
console.log('All self-tests passed.');
