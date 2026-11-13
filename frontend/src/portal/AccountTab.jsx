import { useState } from 'react';
import { changePassword } from './portalApi.js';

export default function AccountTab({ user }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  async function submit(e) {
    e.preventDefault(); setMsg(null);
    try { await changePassword(cur, next); setMsg({ ok: true, text: 'Password changed.' }); setCur(''); setNext(''); }
    catch (x) { setMsg({ ok: false, text: x.status === 401 ? 'Current password is wrong.' : 'New password must be at least 8 characters.' }); }
  }
  return (
    <form className="card formcol" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>{user.full_name}</h2>
      <p className="muted">{user.username} · {user.role}{user.station ? ` · ${user.station}` : ''}</p>
      <label>Current password<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>
      <label>New password (min 8)<input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
      <button className="primary" disabled={!cur || next.length < 8}>Change password</button>
      {msg && <p className={msg.ok ? 'okbox' : 'error'}>{msg.text}</p>}
    </form>
  );
}
