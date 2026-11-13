import { useCallback, useEffect, useState } from 'react';
import { listDevices, createDevice, updateDevice } from '../portal/portalApi.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');
const ERR = { name_taken: 'That device name is taken.', invalid_name: 'Device name: 2-40 letters/numbers.' };

export default function DevicesTab() {
  const [devices, setDevices] = useState([]);
  const [d, setD] = useState({ name: '', type: 'police_post' });
  const [newKey, setNewKey] = useState(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { listDevices().then(setDevices).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => { e.preventDefault(); setMsg(''); try { setNewKey(await createDevice(d)); setD({ name: '', type: 'police_post' }); load(); } catch (x) { setMsg(ERR[x.message] || 'Something went wrong.'); } };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Devices (ESP32 police posts and vehicle units)</h2>
      {msg && <p className="error" role="alert">{msg}</p>}
      <div className="tablewrap"><table className="tbl">
        <thead><tr><th>Name</th><th>Type</th><th>Last seen</th><th>Status</th><th /></tr></thead>
        <tbody>{devices.length === 0 && <tr><td colSpan="5" className="muted">No devices yet.</td></tr>}
          {devices.map((x) => (
            <tr key={x.id} className={x.active ? '' : 'off'}>
              <td>{x.name}</td><td>{x.type === 'police_post' ? 'Police post' : 'Vehicle unit'}</td><td>{when(x.last_seen)}</td><td>{x.active ? 'active' : 'revoked'}</td>
              <td><button className="ghost" onClick={async () => { await updateDevice(x.id, { active: !x.active }); load(); }}>{x.active ? 'Revoke' : 'Re-enable'}</button></td>
            </tr>))}
        </tbody></table></div>
      <form className="card formgrid" onSubmit={add}>
        <b>Register a device</b>
        <input placeholder="Device name (e.g. Kimironko-Post-1)" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}><option value="police_post">Police post</option><option value="vehicle">Vehicle unit</option></select>
        <button className="primary" disabled={!d.name}>Create key</button>
      </form>
      {newKey && (
        <div className="keybox" role="status">
          <b>Key for {newKey.name}. Copy it now: it is shown only once.</b>
          <code>{newKey.key}</code>
          <div className="row2"><button className="ghost" onClick={() => navigator.clipboard?.writeText(newKey.key)}>Copy</button><button className="ghost" onClick={() => setNewKey(null)}>Done</button></div>
        </div>
      )}
    </>
  );
}
