import { useEffect, useRef, useState } from 'react';
import { haversine, distToPolyline } from '../shared/geo.js';
import { postPublicProbe } from '../shared/api.js';

// Follows the driver's GPS, re-plans when off route (or every 45 s for fresh traffic),
// and optionally shares anonymous speed samples.
export default function useNavigation({ active, route, dest, share, onReroute, onArrive }) {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState('');
  const routeRef = useRef(route), cb = useRef({}), last = useRef({ reroute: 0, probe: 0 });
  routeRef.current = route; cb.current = { onReroute, onArrive };
  const session = useRef(sessionStorage.getItem('inzira_sid') || (() => {
    const s = crypto.randomUUID(); sessionStorage.setItem('inzira_sid', s); return s;
  })());

  useEffect(() => {
    if (!active) { setPos(null); return undefined; }
    if (!navigator.geolocation) { setError('locDenied'); return undefined; }
    last.current = { reroute: 0, probe: 0 };
    const id = navigator.geolocation.watchPosition((p) => {
      const c = p.coords;
      const cur = { lat: c.latitude, lng: c.longitude, speed: c.speed != null ? c.speed * 3.6 : null, heading: c.heading };
      setPos(cur); setError('');
      const now = Date.now(), rt = routeRef.current;
      if (dest && haversine(cur, dest) < 40) { cb.current.onArrive(); return; }
      const off = rt && distToPolyline(cur, rt.coordinates) > 80;
      const since = now - last.current.reroute;
      if (!last.current.reroute || (off && since > 10000) || since > 45000) { last.current.reroute = now; cb.current.onReroute(cur); }
      if (share && cur.speed != null && now - last.current.probe > 10000) {
        last.current.probe = now;
        postPublicProbe({ session_id: session.current, lat: cur.lat, lng: cur.lng, speed_kmh: Math.round(cur.speed), heading: cur.heading }).catch(() => {});
      }
    }, () => setError('locDenied'), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [active, share, dest?.lat, dest?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pos, error };
}
