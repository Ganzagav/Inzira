import { useCallback, useEffect, useState } from 'react';
import MapView from './MapView.jsx';
import RoutePanel from './RoutePanel.jsx';
import useNavigation from './useNavigation.js';
import Logo from '../shared/Logo.jsx';
import { LANGS, t } from '../shared/i18n.js';
import { getMeta, getNetwork, getProbes, getRoute, placeNear } from '../shared/api.js';

const parsePoint = (s) => {
  if (!s) return null;
  const [lat, lng, ...name] = s.split(',');
  return Number.isFinite(+lat) && Number.isFinite(+lng) ? { lat: +lat, lng: +lng, name: name.join(',') || `${(+lat).toFixed(4)}, ${(+lng).toFixed(4)}` } : null;
};
const fmt = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.name}`;

export default function App() {
  const qs = new URLSearchParams(location.search);
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'rw');
  const [meta, setMeta] = useState(null);
  const [network, setNetwork] = useState(null);
  const [probes, setProbes] = useState([]);
  const [from, setFrom] = useState(() => parsePoint(qs.get('from')));
  const [to, setTo] = useState(() => parsePoint(qs.get('to')));
  const [pick, setPick] = useState(null);
  const [avoid, setAvoid] = useState(false);
  const [showTraffic, setShowTraffic] = useState(true);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState('fastest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locError, setLocError] = useState('');
  const [focus, setFocus] = useState(null);
  const [copied, setCopied] = useState(false);
  const [navOn, setNavOn] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [share, setShare] = useState(false);

  useEffect(() => { localStorage.setItem('lang', lang); document.documentElement.lang = lang; }, [lang]);

  const refresh = useCallback(async () => {
    try { const [n, p] = await Promise.all([getNetwork(), getProbes()]); setNetwork(n); setProbes(p); } catch { /* keep last */ }
  }, []);
  useEffect(() => {
    getMeta().then((m) => { setMeta(m); if (!m.imported) setError('notImported'); }).catch(() => setError('apiError'));
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // Plan the route whenever both points (or the options) change
  useEffect(() => {
    if (!from || !to) { setResult(null); return undefined; }
    let alive = true;
    setBusy(true);
    const id = setTimeout(async () => {
      try {
        const r = await getRoute(from, to, avoid);
        if (!alive) return;
        setResult(r); setError(''); setSelected((s) => (r[s] ? s : 'fastest'));
      } catch (e) {
        if (!alive) return;
        setResult(null);
        setError(e.status === 422 ? 'outsideArea' : e.status === 404 ? 'noRoute' : e.status === 503 ? 'notImported' : e.status === 400 && e.message === 'too_close' ? 'tooClose' : 'apiError');
      } finally { if (alive) setBusy(false); }
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [from, to, avoid]);

  // Shareable URL
  useEffect(() => {
    const u = new URLSearchParams();
    if (from) u.set('from', fmt(from));
    if (to) u.set('to', fmt(to));
    history.replaceState(null, '', u.toString() ? `?${u}` : location.pathname);
  }, [from, to]);

  const label = async (pt, fallback) => {
    try { const n = await placeNear(pt.lat, pt.lng); if (n) return t(lang, 'near', { name: n.name }); } catch { /* ignore */ }
    return fallback;
  };
  const setPoint = async (which, pt, fallback) => {
    const named = { ...pt, name: fallback };
    (which === 'from' ? setFrom : setTo)(named);                 // show instantly
    const name = await label(pt, fallback);
    (which === 'from' ? setFrom : setTo)((cur) => (cur && cur.lat === pt.lat && cur.lng === pt.lng ? { ...cur, name } : cur));
  };
  const onMapPick = (ll) => { if (pick) { setPoint(pick, { lat: ll.lat, lng: ll.lng }, `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`); setPick(null); } };
  const locate = (which) => {
    setLocError('');
    if (!navigator.geolocation) return setLocError('locDenied');
    navigator.geolocation.getCurrentPosition(
      (p) => setPoint(which, { lat: p.coords.latitude, lng: p.coords.longitude }, t(lang, 'myLocation')),
      () => setLocError('locDenied'), { enableHighAccuracy: true, timeout: 15000 });
  };
  const swap = () => { setFrom(to); setTo(from); };

  const route = result?.[selected] || null;
  const nav = useNavigation({
    active: navOn, route, dest: to, share,
    onReroute: (cur) => setFrom({ lat: cur.lat, lng: cur.lng, name: t(lang, 'myLocation') }),
    onArrive: () => { setArrived(true); },
  });

  const copyLink = async () => { await navigator.clipboard?.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo size={38} />
          <div><h1>Inzira</h1><p>{t(lang, 'tagline')}</p></div>
        </div>
        <select className="lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </header>
      <main className="layout">
        <aside className="side">
          <RoutePanel {...{ lang, from, to, pick, result, selected, route, network, busy, error, avoid, showTraffic, share, copied, navOn, arrived }}
            locError={locError || nav.error}
            setFrom={setFrom} setTo={setTo} setPick={setPick} setAvoid={setAvoid} setShowTraffic={setShowTraffic}
            setSelected={setSelected} setShare={setShare} locate={locate} swap={swap} copyLink={copyLink}
            onStep={(c) => setFocus([...c])} startNav={() => { setArrived(false); setNavOn(true); }} stopNav={() => setNavOn(false)} />
        </aside>
        <section className="mapwrap">
          <MapView {...{ lang, meta, network, probes, showTraffic, result, selected, route, from, to, pick, focus }}
            onSelect={setSelected} onPick={onMapPick} navPos={navOn ? nav.pos : null} />
        </section>
      </main>
    </div>
  );
}
