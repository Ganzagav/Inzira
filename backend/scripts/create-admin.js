// npm run create-admin -- <username> <password> "<Full name>"
import { pool } from '../src/db.js';
import { hashPassword } from '../src/middleware.js';

const [username, password, ...nameParts] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- <username> <password (min 8 chars)> "<Full name>"');
  process.exit(1);
}
const name = nameParts.join(' ') || username;
await pool.query(
  `INSERT INTO users (username, full_name, role, password_hash) VALUES ($1,$2,'admin',$3)
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', active = true`,
  [username.toLowerCase(), name, await hashPassword(password)]);
console.log(`Admin "${username}" is ready. Log in at /police/ on the web app.`);
await pool.end();
