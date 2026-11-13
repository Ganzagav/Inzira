import 'dotenv/config';
import pg from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL is not set (see .env.example)');

const isLocal = /localhost|127\.0\.0\.1/.test(raw);
// Strip sslmode from the URL (it triggers a pg warning) and set TLS explicitly instead.
const u = new URL(raw);
u.searchParams.delete('sslmode');
u.searchParams.delete('channel_binding');

export const pool = new pg.Pool({
  connectionString: u.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: true },
  max: 5,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 10_000,   // drop idle sockets before Neon's pooler does
  keepAlive: true,
});

// IMPORTANT: without this handler a dropped idle connection crashes the whole process.
pool.on('error', (err) => console.warn('[db] idle client error (ignored):', err.code || err.message));

export const query = (text, params) => pool.query(text, params);
