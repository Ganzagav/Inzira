import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { selectRoad, createIncident } from '../portal/portalApi.js';
import { getMeta } from '../shared/api.js';

const TYPES = [
  { k: 'congestion', label: 'Heavy traffic', hint: 'Slows the road' },
  { k: 'accident', label: 'Accident', hint: 'Slows the road' },
  { k: 'closure', label: 'Road closed', hint: 'Route avoids it' },
  { k: 'roadworks', label: 'Roadworks', hint: 'Very slow, one lane' },
  { k: 'clear', label: 'Cleared', hint: 'Overrides jam reports' },
];
const CAUSES = [['event', 'Public event'], ['security', 'Security / VIP movement'], ['construction', 'Construction'], ['accident', 'Accident'], ['other', 'Other']];
const MINUTES = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [1440, '24 hours']];
const ICON = { closure: '⛔', roadworks: '🚧', accident: '⚠️', congestion: '🚗' };
const mk = (html, size) => L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size], html });
const target = L.divIcon({ className: '', iconSize: [34, 42], iconAnchor: [17, 40], html: '<div class="pin pin-b"><span>!</span></div>' });

function Clicks({ onPick }) { useMapEvents({ click: (e) => onPick(e.latlng) }); return null; }

export default function ReportTab({ active, onDone }) {
  const [pt, setPt] = useState(null);
  const [radius, setRadius] = useState(500);
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState('');
  const [type, setType] = useState('congestion');
  const [level, setLevel] = useState(3);
  const [cause, setCause] = useState('event');
  const [minutes, setMinutes] = useState(60);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);

  useEffect(() => { getMeta().then(setMeta).catch(() => {}); }, []);

  useEffect(() => {
    if (!pt) return undefined;
    let alive = true;
    const id = setTimeout(() => {
      selectRoad(pt.lat, pt.lng, radius)
        .then((r) => { if (alive) { setPreview(r); setPreviewErr(''); } })
        .catch((e) => { if (alive) { setPreview(null); setPreviewErr(e.status === 503 ? 'NO_DATA' : e.status === 404 ? 'No road found within 250 m of that point. Zoom in and click directly on a road.' : 'Could not load the road.'); } });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [pt, radius]);

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const body = { lat: pt.lat, lng: pt.lng, radius_m: radius, type, note, minutes };
      if (type === 'congestion' || type === 'accident') body.level = level;
      if (type === 'closure') body.cause = cause;
      const r = await createIncident(body);
      setMsg({ ok: true, text: `Saved: ${r.road || 'road'} (${r.edges} segments, ${(r.length_m / 1000).toFixed(1)} km). Drivers see it within seconds.` });
      setPt(null); setPreview(null); setNote(''); onDone();
    } catch (e) { setMsg({ ok: false, text: e.status === 503 ? 'No road data imported yet.' : e.status === 404 ? 'No road near that point.' : 'Could not save the report.' }); }
    finally { setBusy(false); }
  }

  return (
    <main className="layout">
      <aside className="side">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>1. Click the road on the map</h2>
          {meta && !meta.imported && <p className="error"><b>No road data has been imported yet.</b> Ask an administrator to import it (Administration portal → Road network). Until then roads cannot be selected.</p>}
          {!pt && <p className="muted">Zoom in and click on the road where the situation is. The affected stretch is highlighted.</p>}
          {preview && <p className="okbox"><b>{preview.name || `Unnamed ${preview.highway} road`}</b><br />{preview.count} segments · {(preview.length_m / 1000).toFixed(2)} km selected</p>}
          {previewErr && previewErr !== 'NO_DATA' && <p className="error">{previewErr}</p>}
          <label>Length along the road: <b>{radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}</b> each way
            <input type="range" min="100" max="3000" step="100" value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          </label>

          <h2>2. What is happening?</h2>
          <div className="typegrid">
            {TYPES.map((t) => (
              <button type="button" key={t.k} className={type === t.k ? 'typebtn on' : 'typebtn'} onClick={() => setType(t.k)}>
                <b>{t.label}</b><small>{t.hint}</small>
              </button>
            ))}
          </div>
          {(type === 'congestion' || type === 'accident') && (
            <label>Severity: <b>{['', 'Light', 'Moderate', 'Heavy', 'Standstill'][level]}</b>
              <input type="range" min="1" max="4" value={level} onChange={(e) => setLevel(Number(e.target.value))} />
            </label>
          )}
          {type === 'closure' && (
            <label>Reason<select value={cause} onChange={(e) => setCause(e.target.value)}>{CAUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          )}
          {type !== 'clear' && (
            <label>Valid for<select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{MINUTES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          )}
          <label>Note for drivers (optional)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. BK Arena concert, use Kimihurura road" /></label>
          <button className="primary" disabled={!preview || busy} onClick={submit}>{busy ? 'Saving…' : 'Publish to drivers'}</button>
          {msg && <p className={msg.ok ? 'okbox' : 'error'} role="status">{msg.text}</p>}
        </div>
      </aside>
      <section className="mapwrap">
        <MapContainer center={[-1.95, 30.08]} zoom={13} className="map picking" scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Clicks onPick={(ll) => { setPt({ lat: ll.lat, lng: ll.lng }); setMsg(null); }} />
          {active.filter((a) => a.lat != null && a.type !== 'clear').map((a) => (
            <Marker key={a.group_id} position={[a.lat, a.lng]} icon={mk(`<div class="inc">${ICON[a.type] || '⚠️'}</div>`, 28)}>
              <Tooltip><b>{a.road_name || 'Unnamed road'}</b><br />{a.type}{a.note ? ` - ${a.note}` : ''}<br />by {a.created_by}</Tooltip>
            </Marker>
          ))}
          {preview?.lines.map((l, i) => <Polyline key={i} positions={l} pathOptions={{ color: '#ff6a00', weight: 9, opacity: 0.85 }} />)}
          {pt && <Marker position={[pt.lat, pt.lng]} icon={target} />}
        </MapContainer>
      </section>
    </main>
  );
}
