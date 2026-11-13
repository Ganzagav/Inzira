// Demo helper (no hardware). Logs in as an admin/officer and creates incidents at coordinates.
//   node scripts/simulate.js jam   [lat lng]   heavy congestion around a point (default: Kimironko)
//   node scripts/simulate.js event [lat lng]   closes the road for 3 h (BK Arena style event)
//   node scripts/simulate.js works [lat lng]   roadworks (slow)
// Env: SIM_USER, SIM_PASS (an existing account), optional API_URL.
import 'dotenv/config';

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const [cmd, la, ln] = process.argv.slice(2);
const lat = Number(la) || -1.9490, lng = Number(ln) || 30.1250;
if (!process.env.SIM_USER || !process.env.SIM_PASS) { console.error('Set SIM_USER and SIM_PASS (e.g. the admin you created).'); process.exit(1); }

const j = async (path, opts) => { const r = await fetch(API + path, opts); const t = await r.text(); console.log(path, r.status, t); return JSON.parse(t || '{}'); };
const { token } = await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: process.env.SIM_USER, password: process.env.SIM_PASS }) });
const post = (body) => j('/api/incidents', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

if (cmd === 'jam') await post({ lat, lng, radius_m: 1500, type: 'congestion', level: 4, note: 'Peak-hour jam (simulated)', minutes: 60 });
else if (cmd === 'event') await post({ lat, lng, radius_m: 500, type: 'closure', cause: 'event', note: 'Event closure (simulated)', minutes: 180 });
else if (cmd === 'works') await post({ lat, lng, radius_m: 600, type: 'roadworks', note: 'Roadworks (simulated)', minutes: 240 });
else console.log('Usage: node scripts/simulate.js jam|event|works [lat lng]');
