import { useCallback, useEffect, useState } from 'react';
import { getMeta } from '../shared/api.js';
import { startImport, importStatus } from '../portal/portalApi.js';

export default function NetworkPanel() {
  const [meta, setMeta] = useState(null);
  const [job, setJob] = useState(null);
  const [bbox, setBbox] = useState('');
  const [mainOnly, setMainOnly] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    getMeta().then(setMeta).catch(() => {});
    importStatus().then((j) => { setJob(j); setBbox((b) => b || j.default_bbox); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (job?.state !== 'running') return undefined;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [job?.state, load]);

  async function start() {
    const warn = 'This downloads roads from OpenStreetMap and REPLACES the current road network.\nActive incidents and vehicle samples will be cleared (accounts and devices are kept).\n\nContinue?';
    if (!window.confirm(warn)) return;
    setMsg('');
    try { await startImport({ bbox, main_only: mainOnly }); load(); }
    catch (e) {
      setMsg(e.status === 409 ? 'An import is already running.'
        : e.message === 'invalid_bbox' ? 'Area must be "south,west,north,east" in degrees (max 0.6 degrees each way).' : 'Could not start the import.');
    }
  }

  const running = job?.state === 'running';
  return (
    <div className="card formcol" style={{ maxWidth: 'none' }}>
      <h2 style={{ marginTop: 0 }}>Road network (OpenStreetMap)</h2>
      {meta?.imported
        ? <p className="okbox"><b>{meta.edges.toLocaleString()}</b> road segments and {meta.nodes.toLocaleString()} intersections are loaded.</p>
        : <p className="error">No road data yet. Officers cannot select roads and drivers cannot get routes until you import it.</p>}
      <div className="formgrid">
        <label>Area (south,west,north,east)<input value={bbox} onChange={(e) => setBbox(e.target.value)} disabled={running} /></label>
        <label className="check"><input type="checkbox" checked={mainOnly} onChange={(e) => setMainOnly(e.target.checked)} disabled={running} />
          Main roads only (recommended on free hosting)</label>
        <button className="primary" onClick={start} disabled={running || !bbox}>{running ? 'Importing…' : meta?.imported ? 'Re-import roads' : 'Import roads now'}</button>
      </div>
      <small className="muted">Default area is central Kigali. A full import (all streets) needs more memory than free hosting usually has; if it fails, use "main roads only" or run <code>npm run import:osm</code> on your computer.</small>
      {msg && <p className="error">{msg}</p>}
      {job?.state === 'error' && <p className="error">Import failed: {job.error}</p>}
      {job?.state === 'done' && <p className="okbox">Import finished: {job.result.segments} road segments, {job.result.places} places.</p>}
      {job?.log?.length > 0 && <pre className="log">{job.log.join('\n')}</pre>}
    </div>
  );
}
