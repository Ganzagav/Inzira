import { useState } from 'react';
import Logo from '../shared/Logo.jsx';
import { login } from './portalApi.js';
import { tokenStore } from '../shared/api.js';

const TITLES = { police: 'Traffic police portal', admin: 'Administration portal' };
const OTHER = { police: ['/admin/', 'Administration portal'], admin: ['/police/', 'Traffic police portal'] };

export default function Login({ portal, onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await login(u, p, portal); tokenStore.set(r.token); onLogin(r.user); }
    catch (x) {
      if (x.status === 403 && x.data?.error === 'wrong_portal') setErr({ wrong: true });
      else setErr({ text: x.status === 429 ? 'Too many attempts. Please wait 15 minutes.' : x.status === 401 ? 'Wrong username or password.' : 'Cannot reach the server.' });
    } finally { setBusy(false); }
  }

  return (
    <div className="loginwrap" data-portal={portal}>
      <form className="logincard" onSubmit={submit}>
        <div className="brand"><Logo size={44} /><div><h1>Inzira</h1><p>{TITLES[portal]}</p></div></div>
        <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        {err?.text && <p className="error" role="alert">{err.text}</p>}
        {err?.wrong && <p className="error" role="alert">This account belongs to a different portal. <a href={OTHER[portal][0]}>Open the {OTHER[portal][1]}</a>.</p>}
        <button className="primary" disabled={busy || !u || !p}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Authorised users only. Actions are logged.</p>
        <a className="backlink" href="/">← Back to the route planner</a>
      </form>
    </div>
  );
}
