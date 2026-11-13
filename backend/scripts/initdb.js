// npm run db:setup  -> create missing tables      npm run db:reset -> DROP everything, then create
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/schema.sql');
if (process.argv.includes('--reset')) {
  await pool.query(`DROP TABLE IF EXISTS audit_log, trips, probes, incidents, devices, users, places, edges, nodes,
                    traffic_reports, closures CASCADE`);
  console.log('Dropped all tables (including users and devices).');
}
await pool.query(fs.readFileSync(file, 'utf8'));
console.log('Schema ready.');
await pool.end();
