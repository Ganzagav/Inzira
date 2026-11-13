import { query } from './db.js';
import { buildStatic, applyLive } from './graphcore.js';

// Road network is loaded once; live conditions are refreshed every few seconds.
const TTL_MS = 8000;
let G = null, staticLoad = null, liveAt = 0, liveLoad = null, sig = '', sigAt = 0;

async function loadStatic() {
  const [n, e] = await Promise.all([
    query('SELECT id, lat, lng FROM nodes'),
    query('SELECT id, way_id, name, highway, from_node, to_node, length_m, road_type, is_major, free_flow_kmh, oneway, geom FROM edges'),
  ]);
  sig = `${e.rows.length}:${e.rows.reduce((m, r) => Math.max(m, r.id), 0)}`;
  return buildStatic(n.rows, e.rows);
}

// Has the road table changed (import finished from the CLI or the portal)? Then reload the graph.
async function roadsChanged() {
  const every = G && G.edges.length ? 30_000 : 4_000; // check often while there are no roads yet
  if (Date.now() - sigAt < every) return false;
  sigAt = Date.now();
  try {
    const q = await query('SELECT COUNT(*)::int AS c, COALESCE(MAX(id), 0)::int AS m FROM edges');
    return `${q.rows[0].c}:${q.rows[0].m}` !== sig;
  } catch { return false; }
}

async function refreshLive() {
  try {
    const [inc, pr] = await Promise.all([
      query(`SELECT edge_id, type, cause, level, note, ends_at FROM incidents
             WHERE cancelled_at IS NULL AND ends_at > now() ORDER BY created_at ASC`),
      query(`SELECT edge_id, AVG(speed_kmh) AS avg_speed, COUNT(DISTINCT device_hash)::int AS vehicles
             FROM probes WHERE created_at > now() - interval '5 minutes'
               AND edge_id IS NOT NULL AND speed_kmh IS NOT NULL GROUP BY edge_id`),
    ]);
    applyLive(G, inc.rows, pr.rows, Number(process.env.PROBE_MIN_VEHICLES) || 1);
    liveAt = Date.now();
  } catch (err) {
    console.warn('[graph] live refresh failed, using last known state:', err.code || err.message);
    liveAt = Date.now() - TTL_MS + 2000; // retry in ~2 s
  }
}

export async function getGraph() {
  if (G && (await roadsChanged())) { G = null; console.log('[graph] road data changed, reloading'); }
  if (!G) {
    staticLoad ||= loadStatic().then((g) => { G = g; liveAt = 0; console.log(`[graph] loaded ${g.nodes.size} nodes, ${g.edges.length} edges`); })
      .finally(() => { staticLoad = null; });
    await staticLoad;
  }
  if (Date.now() - liveAt > TTL_MS) {
    liveLoad ||= refreshLive().finally(() => { liveLoad = null; });
    await liveLoad;
  }
  return G;
}
export const invalidateLive = () => { liveAt = 0; };
export const reloadStatic = () => { G = null; sigAt = 0; };
