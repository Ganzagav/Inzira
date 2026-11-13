import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { query } from './db.js';
import { getGraph } from './graph.js';
import network from './routes/network.js';
import route from './routes/route.js';
import traffic from './routes/traffic.js';
import { auth, admin } from './routes/auth.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET is missing. Generate one with: openssl rand -hex 32  and add it to .env');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // behind Render's proxy: correct client IPs for rate limiting
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '50kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', auth);
app.use('/api/admin', admin);
app.use('/api', network);
app.use('/api', route);
app.use('/api', traffic);

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, _req, res, _next) => {
  console.error('[error]', err.code || '', err.message);
  res.status(500).json({ error: 'server_error' });
});

// Privacy: delete vehicle samples older than 24 h, hourly.
setInterval(() => query(`DELETE FROM probes WHERE created_at < now() - interval '24 hours'`).catch((e) => console.warn('[cleanup]', e.message)), 3_600_000);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Inzira API listening on :${port}`);
  getGraph().catch((e) => console.warn('[graph] warm-up failed (is the DB set up?):', e.code || e.message));
});
