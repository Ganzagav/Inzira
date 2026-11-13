import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { t } from '../shared/i18n.js';

export const LEVEL_COLORS = ['#2e9e5b', '#8bc34a', '#f5a623', '#e0452b', '#8b1a1a'];
const pin = (txt, cls) => L.divIcon({ className: '', iconSize: [34, 42], iconAnchor: [17, 40], html: `<div class="pin ${cls}"><span>${txt}</span></div>` });
const ICON = { closure: '⛔', roadworks: '🚧', accident: '⚠️', congestion: '🚗' };
const incIcon = (type) => L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="inc">${ICON[type] || '⚠️'}</div>` });

function Clicks({ active, onPick }) {
  useMapEvents({ click: (e) => { if (active) onPick(e.latlng); } });
  return null;
}
function Controller({ meta, route, focus, follow }) {
  const map = useMap();
  useEffect(() => { // start on the covered area
    if (meta?.bbox) map.fitBounds([[meta.bbox.south, meta.bbox.west], [meta.bbox.north, meta.bbox.east]]);
  }, [meta, map]);
  const sig = route ? route.edge_ids.join('-') : '';
  useEffect(() => { if (route && !follow) map.fitBounds(route.coordinates, { padding: [70, 70] }); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) map.flyTo(focus, 17); }, [focus, map]);
  useEffect(() => { if (follow) map.panTo([follow.lat, follow.lng]); }, [follow, map]);
  return null;
}

export default function MapView({ lang, meta, network, probes, showTraffic, result, selected, onSelect, route, from, to, pick, onPick, focus, navPos }) {
  const others = useMemo(() => {
    if (!result || !route) return [];
    const key = route.edge_ids.join();
    return ['fastest', 'shortest', 'alternative'].filter((k) => result[k] && k !== selected && result[k].edge_ids.join() !== key)
      .filter((k, i, arr) => arr.findIndex((x) => result[x].edge_ids.join() === result[k].edge_ids.join()) === i);
  }, [result, route, selected]);

  return (
    <MapContainer center={[-1.95, 30.08]} zoom={12} className={pick ? 'map picking' : 'map'} scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Controller meta={meta} route={route} focus={focus} follow={navPos} />
      <Clicks active={Boolean(pick)} onPick={onPick} />

      {showTraffic && network?.segments.map((s) => (
        <Polyline key={s.id} positions={s.line}
          pathOptions={{ color: s.blocked ? '#111' : s.level === 0 && s.status !== 'open' ? '#f5a623' : LEVEL_COLORS[s.level], weight: 7, opacity: 0.85,
            dashArray: s.blocked ? '4 8' : s.status !== 'open' ? '10 8' : null }}>
          <Tooltip sticky>
            <b>{s.name || t(lang, 'unnamed')}</b><br />
            {s.blocked ? t(lang, 'closed') : s.status !== 'open' ? t(lang, 'roadworks') : t(lang, `level${s.level}`)}
            {s.probe_speed != null && <><br />{s.probe_speed} km/h</>}
          </Tooltip>
        </Polyline>
      ))}
      {showTraffic && network?.incidents.map((i) => i.lat != null && (
        <Marker key={i.group_id} position={[i.lat, i.lng]} icon={incIcon(i.type)}>
          <Tooltip><b>{i.road || t(lang, 'unnamed')}</b>{i.note ? <><br />{i.note}</> : null}</Tooltip>
        </Marker>
      ))}

      {others.map((k) => (
        <Polyline key={k} positions={result[k].coordinates} eventHandlers={{ click: () => onSelect(k) }}
          pathOptions={{ color: '#7b7f95', weight: 6, opacity: 0.75 }}>
          <Tooltip sticky>{t(lang, k)} · {Math.max(1, Math.round(result[k].duration_s / 60))} min</Tooltip>
        </Polyline>
      ))}
      {route && <Polyline positions={route.coordinates} pathOptions={{ color: '#fff', weight: 12, opacity: 0.95 }} />}
      {route && <Polyline positions={route.coordinates} pathOptions={{ color: '#0b4fb0', weight: 7, opacity: 1 }} />}

      {result && [['from', from], ['to', to]].map(([k, p]) => p && result[k].snap_m > 30 && (
        <Polyline key={`snap-${k}`} positions={[[p.lat, p.lng], [result[k].lat, result[k].lng]]} pathOptions={{ color: '#0b4fb0', weight: 3, dashArray: '2 6' }} />
      ))}
      {from && <Marker position={[from.lat, from.lng]} icon={pin('A', 'pin-a')}><Tooltip>{from.name}</Tooltip></Marker>}
      {to && <Marker position={[to.lat, to.lng]} icon={pin('B', 'pin-b')}><Tooltip>{to.name}</Tooltip></Marker>}

      {showTraffic && probes.map((p, i) => (
        <CircleMarker key={i} center={[p.lat, p.lng]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#7a3cff', fillOpacity: 1 }}>
          <Tooltip>{t(lang, 'vehicles')}: {Math.round(p.speed_kmh ?? 0)} km/h</Tooltip>
        </CircleMarker>
      ))}
      {navPos && <CircleMarker center={[navPos.lat, navPos.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }} />}
    </MapContainer>
  );
}
