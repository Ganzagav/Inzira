import { useEffect, useState } from 'react';
import { listIncidents, cancelIncident, tripStats } from './portalApi.js';
import { getProbes } from '../shared/api.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const LABEL = { congestion: 'Heavy traffic', accident: 'Accident', closure: 'Road closed', roadworks: 'Roadworks', clear: 'Cleared' };

// Active incidents + history. Officers can cancel their own; admins can cancel any.
export default function ActivityTab({ user, active, onChange, showStats = true }) {
  const [view, setView] = useState('active');
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState([]);
  const [vehicles, setVehicles] = useState(0);

  useEffect(() => {
    if (!showStats) return;
    tripStats().then(setStats).catch(() => {});
    getProbes().then((p) => setVehicles(p.length)).catch(() => {});
  }, [showStats]);
  useEffect(() => { if (view === 'history') listIncidents('history').then(setHistory).catch(() => {}); }, [view]);

  const rows = view === 'active' ? active : history;
  const canCancel = (r) => user.role === 'admin' || r.created_ref === `user:${user.id}`;
  async function cancel(r) {
    if (!window.confirm(`Cancel "${LABEL[r.type]}" on ${r.road_name || 'this road'}? Drivers will see the road as normal again.`)) return;
    await cancelIncident(r.group_id); onChange();
  }

  return (
    <>
      <div className="cards">
        <div className="statcard"><b>{active.filter((a) => a.type !== 'clear').length}</b><span>active incidents</span></div>
        <div className="statcard"><b>{active.filter((a) => a.type === 'closure').length}</b><span>closed roads</span></div>
        {showStats && <div className="statcard"><b>{vehicles}</b><span>vehicles reporting now</span></div>}
      </div>

      <div className="seg">
        <button className={view === 'active' ? 'on' : ''} onClick={() => setView('active')}>Active</button>
        <button className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>Last 7 days</button>
      </div>
      <div className="tablewrap">
        <table className="tbl">
          <thead><tr><th>Type</th><th>Road</th><th>Details</th><th>By</th><th>Started</th><th>Until</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7" className="muted">Nothing to show.</td></tr>}
            {rows.map((r) => (
              <tr key={r.group_id}>
                <td><span className={`tag t-${r.type}`}>{LABEL[r.type]}</span></td>
                <td>{r.road_name || 'Unnamed road'}<small>{r.edges} segments · {r.radius_m} m</small></td>
                <td>{r.type === 'closure' ? r.cause : r.level ? `level ${r.level}` : ''}{r.note ? ` · ${r.note}` : ''}</td>
                <td>{r.created_by}</td><td>{when(r.created_at)}</td>
                <td>{r.cancelled_at ? `cancelled ${when(r.cancelled_at)}` : when(r.ends_at)}</td>
                <td>{view === 'active' && canCancel(r) && <button className="ghost" onClick={() => cancel(r)}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showStats && (<>
        <h2>Estimated vs actual travel time (evaluation data)</h2>
        {stats.length === 0 ? <p className="muted">No trips logged yet. Vehicle units post finished trips to <code>/api/trips</code>.</p> : (
          <div className="tablewrap"><table className="tbl"><thead><tr><th>Route type</th><th>Trips</th><th>Avg estimated</th><th>Avg actual</th><th>Avg error</th></tr></thead>
            <tbody>{stats.map((s) => <tr key={s.mode}><td>{s.mode}</td><td>{s.trips}</td><td>{Math.round(s.avg_estimated_s / 60)} min</td><td>{Math.round(s.avg_actual_s / 60)} min</td><td>{s.avg_error_pct}%</td></tr>)}</tbody></table></div>
        )}
      </>)}
    </>
  );
}
