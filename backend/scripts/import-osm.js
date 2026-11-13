// Import real roads + searchable places for Kigali from OpenStreetMap (Overpass API).
//   npm run import:osm                       default bbox (central Kigali)
//   npm run import:osm -- --main-only        only primary/secondary/tertiary (small + fast)
//   npm run import:osm -- --bbox=S,W,N,E     custom area
//   npm run import:osm -- --save=roads.json  keep the download      --file=roads.json  reuse it
// WARNING: replaces nodes/edges/places and clears incidents + probes (users/devices are kept).
// The running server notices the new roads within ~5-30 seconds (no restart needed).
import { pool } from '../src/db.js';
import { runImport, DEFAULT_BBOX } from '../src/osmImport.js';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const flag = (n) => process.argv.includes(`--${n}`);
try {
  await runImport({ bbox: arg('bbox') || DEFAULT_BBOX, mainOnly: flag('main-only'), noPlaces: flag('no-places'), file: arg('file'), save: arg('save') });
} catch (e) {
  console.error('Import failed:', e.message);
  process.exitCode = 1;
} finally { await pool.end(); }
