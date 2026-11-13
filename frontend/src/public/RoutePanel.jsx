import { t } from '../shared/i18n.js';
import { LEVEL_COLORS } from './MapView.jsx';
import PlaceSearch from './PlaceSearch.jsx';

const mins = (s) => Math.max(1, Math.round(s / 60));
const km = (m) => (m / 1000).toFixed(1);
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function RoutePanel(p) {
  const { lang, from, to, pick, result, selected, route, network } = p;
  const options = ['fastest', 'shortest', 'alternative'].filter((k) => result?.[k]);
  const which = (k) => t(lang, k).toLowerCase();

  return (
    <div className="panel">
      <PlaceSearch lang={lang} label={t(lang, 'from')} point={from} picking={pick === 'from'}
        onSelect={p.setFrom} onLocate={() => p.locate('from')} onPick={() => p.setPick(pick === 'from' ? null : 'from')} />
      <button className="swap" onClick={p.swap} aria-label={t(lang, 'swap')} title={t(lang, 'swap')}>⇅</button>
      <PlaceSearch lang={lang} label={t(lang, 'to')} point={to} picking={pick === 'to'}
        onSelect={p.setTo} onLocate={() => p.locate('to')} onPick={() => p.setPick(pick === 'to' ? null : 'to')} />
      {pick && <p className="hint">{t(lang, 'picking', { which: which(pick) })}</p>}

      <label className="check"><input type="checkbox" checked={p.avoid} onChange={(e) => p.setAvoid(e.target.checked)} />{t(lang, 'avoidUnpaved')}</label>
      <label className="check"><input type="checkbox" checked={p.showTraffic} onChange={(e) => p.setShowTraffic(e.target.checked)} />{t(lang, 'showTraffic')}</label>

      {p.busy && <p className="muted">{t(lang, 'loading')}</p>}
      {p.error && <p className="error" role="alert">{t(lang, p.error)}</p>}
      {p.locError && <p className="error" role="alert">{t(lang, p.locError)}</p>}

      {result && route && (
        <>
          <div className="choices" role="tablist">
            {options.map((k) => (
              <button key={k} role="tab" aria-selected={selected === k} className={selected === k ? 'choice on' : 'choice'} onClick={() => p.setSelected(k)}>
                <span>{t(lang, k)}</span><strong>{mins(result[k].duration_s)} min</strong><small>{km(result[k].distance_m)} km</small>
              </button>
            ))}
          </div>
          <p className="compare">
            {result.comparison.same_route || result.comparison.time_saved_s < 60 ? t(lang, 'sameRoute') : t(lang, 'saves', { min: mins(result.comparison.time_saved_s) })}
          </p>
          <dl className="stats">
            <div><dt>{t(lang, 'time')}</dt><dd>{mins(route.duration_s)} min</dd></div>
            <div><dt>{t(lang, 'distance')}</dt><dd>{km(route.distance_m)} km</dd></div>
            <div><dt>{t(lang, 'fuel')}</dt><dd>~{route.fuel_l} L</dd></div>
          </dl>

          <div className="navbar">
            {!p.navOn
              ? <button className="primary" onClick={p.startNav}>{t(lang, 'startNav')}</button>
              : <button className="danger" onClick={p.stopNav}>{t(lang, 'stopNav')}</button>}
            <button className="ghost" onClick={p.copyLink}>{p.copied ? t(lang, 'copied') : t(lang, 'copyLink')}</button>
          </div>
          {p.navOn && <p className="muted">{p.arrived ? t(lang, 'arrived') : t(lang, 'following')}</p>}
          <label className="check"><input type="checkbox" checked={p.share} onChange={(e) => p.setShare(e.target.checked)} />{t(lang, 'shareProbes')}</label>

          {route.warnings.length > 0 && (
            <ul className="warnings">{route.warnings.map((w, i) => <li key={i}>{t(lang, `warn_${w.type}`)} {w.road || t(lang, 'unnamed')}</li>)}</ul>
          )}

          <h2>{t(lang, 'directions')}</h2>
          <ol className="steps">
            {route.steps.map((s, i) => (
              <li key={i}>
                <button onClick={() => p.onStep(s.start)}>
                  <i className="dot" style={{ background: LEVEL_COLORS[s.level] }} />
                  <span>{t(lang, `turn_${s.turn}`)} {s.road || t(lang, 'unnamed')}
                    <small>{km(s.distance_m)} km · {mins(s.seconds)} min</small></span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2>{t(lang, 'alerts')}</h2>
      {network?.alerts.length ? (
        <ul className="alerts">
          {network.alerts.map((a, i) => (
            <li key={i} className={a.type === 'closed' ? 'bad' : ''}>
              <b>{t(lang, a.type)}</b> {a.road || t(lang, 'unnamed')}{a.reason ? ` - ${a.reason}` : ''}
              {a.until ? <small> ({t(lang, 'until', { time: clock(a.until) })})</small> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">{t(lang, 'noAlerts')}</p>}

      <h2>{t(lang, 'legend')}</h2>
      <div className="legend">{LEVEL_COLORS.map((c, i) => <span key={i}><i style={{ background: c }} />{t(lang, `level${i}`)}</span>)}</div>
      <p className="footlink"><a href="/police/">{t(lang, 'policePortal')} →</a></p>
    </div>
  );
}
