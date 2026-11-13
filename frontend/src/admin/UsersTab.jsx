import { useCallback, useEffect, useState } from 'react';
import { listUsers, createUser, updateUser } from '../portal/portalApi.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');
const ERR = { username_taken: 'That username is taken.', password_min_8: 'Password must be at least 8 characters.', invalid_username: 'Username: 3-32 chars, a-z 0-9 . _ -', cannot_lock_yourself_out: 'You cannot disable or demote yourself.' };
const EMPTY = { username: '', full_name: '', station: '', role: 'officer', password: '' };

export default function UsersTab({ me }) {
  const [users, setUsers] = useState([]);
  const [u, setU] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { listUsers().then(setUsers).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const fail = (e) => setMsg(ERR[e.message] || 'Something went wrong.');

  const add = async (e) => { e.preventDefault(); setMsg(''); try { await createUser(u); setU(EMPTY); load(); } catch (x) { fail(x); } };
  const resetPw = async (x) => { const p = window.prompt(`New password for ${x.username} (min 8 characters):`); if (p) { try { await updateUser(x.id, { password: p }); setMsg('Password changed.'); } catch (e) { fail(e); } } };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Officers and administrators</h2>
      {msg && <p className="error" role="alert">{msg}</p>}
      <div className="tablewrap"><table className="tbl">
        <thead><tr><th>Name</th><th>Username</th><th>Station</th><th>Role</th><th>Last login</th><th /></tr></thead>
        <tbody>{users.map((x) => (
          <tr key={x.id} className={x.active ? '' : 'off'}>
            <td>{x.full_name}</td><td>{x.username}</td><td>{x.station || '-'}</td><td>{x.role === 'admin' ? 'Administrator' : 'Traffic officer'}</td><td>{when(x.last_login)}</td>
            <td className="actions">
              <button className="ghost" onClick={() => resetPw(x)}>Reset password</button>
              {x.id !== me.id && <button className="ghost" onClick={async () => { await updateUser(x.id, { active: !x.active }); load(); }}>{x.active ? 'Disable' : 'Enable'}</button>}
            </td>
          </tr>))}
        </tbody></table></div>
      <form className="card formgrid" onSubmit={add}>
        <b>Add a user</b>
        <input placeholder="Full name" value={u.full_name} onChange={(e) => setU({ ...u, full_name: e.target.value })} />
        <input placeholder="Username" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} autoComplete="off" />
        <input placeholder="Station (e.g. Kimironko)" value={u.station} onChange={(e) => setU({ ...u, station: e.target.value })} />
        <select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}><option value="officer">Traffic officer (police portal)</option><option value="admin">Administrator (admin portal)</option></select>
        <input type="password" placeholder="Temporary password (min 8)" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} autoComplete="new-password" />
        <button className="primary" disabled={!u.username || !u.full_name || u.password.length < 8}>Create</button>
      </form>
    </>
  );
}
