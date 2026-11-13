import { useCallback, useEffect, useState } from 'react';
import { listAudit } from '../portal/portalApi.js';

const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function AuditTab() {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => { listAudit().then(setRows).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="spread"><h2 style={{ margin: 0 }}>Audit log (latest 60 actions)</h2><button className="ghost" onClick={load}>Refresh</button></div>
      <div className="tablewrap"><table className="tbl">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.actor}</td><td>{a.action}</td><td><small>{a.detail ? JSON.stringify(a.detail) : ''}</small></td></tr>)}</tbody>
      </table></div>
    </>
  );
}
