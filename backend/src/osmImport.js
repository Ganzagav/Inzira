// Import roads + places from OpenStreetMap (Overpass) into the database.
// Used by scripts/import-osm.js (command line) and by the admin portal.
import fs from 'node:fs';
import { pool } from './db.js';
import { buildGraph, extractPlaces } from './osm.js';

const MAIN = 'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const ALL = `${MAIN}|unclassified|residential|living_street`;
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export const DEFAULT_BBOX = process.env.OSM_BBOX || '-2.02,30.00,-1.88,30.16';

export function validBbox(s) {
  if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(String(s).trim())) return false;
  const [S, W, N, E] = String(s).split(',').map(Number);
  return S < N && W < E && N - S <= 0.6 && E - W <= 0.6 && Math.abs(S) <= 90 && Math.abs(W) <= 180;
}

async function overpass(ql, log) {
  let lastErr;
  for (const url of MIRRORS) {
    try {
      log(`Contacting ${new URL(url).host} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Inzira-prototype/2.1 (university project)' },
        body: 'data=' + encodeURIComponent(ql), signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; log(`  failed: ${e.message}`); }
  }
  throw new Error(`All Overpass servers failed (${lastErr?.message}). Try again in a few minutes, or use a smaller area / main roads only.`);
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function runImport({ bbox = DEFAULT_BBOX, mainOnly = false, noPlaces = false, file = null, save = null, log = console.log } = {}) {
  if (!validBbox(bbox)) throw new Error('invalid_bbox');
  let roads;
  if (file) roads = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    log(`Downloading roads for ${bbox} (${mainOnly ? 'main roads only' : 'all drivable roads'}) ...`);
    roads = await overpass(`[out:json][timeout:240];way["highway"~"^(${mainOnly ? MAIN : ALL})$"](${bbox});out body;>;out skel qt;`, log);
    if (save) fs.writeFileSync(save, JSON.stringify(roads));
  }
  let places = null;
  if (!noPlaces) {
    log('Downloading place names ...');
    places = await overpass(`[out:json][timeout:120];(
      node["place"~"^(suburb|neighbourhood|quarter|village|town)$"](${bbox});
      nwr["name"]["amenity"~"^(hospital|marketplace|bus_station|university|college|townhall|police|clinic)$"](${bbox});
      nwr["name"]["leisure"~"^(stadium|sports_centre)$"](${bbox});
      nwr["name"]["tourism"~"^(hotel|attraction|museum)$"](${bbox});
      nwr["name"]["shop"="mall"](${bbox});
      nwr["name"]["aeroway"="terminal"](${bbox}););out center;`, log);
  }

  log('Building road graph ...');
  const { nodes, edges, stats } = buildGraph(roads.elements);
  roads = null; // free memory
  log(`Graph: ${stats.nodes} intersections, ${stats.edges} road segments (${stats.edgesBeforeFilter - stats.edges} disconnected segments dropped).`);
  if (!edges.length) throw new Error('No roads found in that area - check the bounding box.');
  const placeRows = places ? extractPlaces(places.elements) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE places, probes, incidents, edges, nodes RESTART IDENTITY CASCADE');
    for (const c of chunks(nodes, 5000)) {
      await client.query('INSERT INTO nodes (id, lat, lng) SELECT * FROM unnest($1::bigint[], $2::float8[], $3::float8[])',
        [c.map((n) => n.id), c.map((n) => n.lat), c.map((n) => n.lng)]);
    }
    let done = 0;
    for (const c of chunks(edges, 1500)) {
      await client.query(
        `INSERT INTO edges (way_id, name, highway, from_node, to_node, length_m, road_type, is_major, free_flow_kmh, oneway, geom)
         SELECT a, b, c, d, e, f, g, h, i, j, k::jsonb
         FROM unnest($1::bigint[], $2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::float8[], $7::text[], $8::bool[], $9::int[], $10::bool[], $11::text[])
         AS t(a,b,c,d,e,f,g,h,i,j,k)`,
        [c.map((e) => e.way_id), c.map((e) => e.name), c.map((e) => e.highway), c.map((e) => e.from_node), c.map((e) => e.to_node),
         c.map((e) => e.length_m), c.map((e) => e.road_type), c.map((e) => e.is_major), c.map((e) => e.free_flow_kmh),
         c.map((e) => e.oneway), c.map((e) => JSON.stringify(e.geom))]);
      done += c.length; log(`Saved ${done}/${edges.length} road segments`);
    }
    for (const c of chunks(placeRows, 2000)) {
      await client.query('INSERT INTO places (name, kind, lat, lng) SELECT * FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[])',
        [c.map((p) => p.name), c.map((p) => p.kind), c.map((p) => p.lat), c.map((p) => p.lng)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  const result = { intersections: nodes.length, segments: edges.length, places: placeRows.length };
  log(`Done: ${result.intersections} intersections, ${result.segments} road segments, ${result.places} places.`);
  return result;
}
