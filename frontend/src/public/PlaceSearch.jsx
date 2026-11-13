import { useEffect, useState } from 'react';
import { t } from '../shared/i18n.js';
import { searchPlaces } from '../shared/api.js';

export default function PlaceSearch({ lang, label, point, picking, onSelect, onLocate, onPick }) {
  const [text, setText] = useState(point?.name || '');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setText(point?.name || ''); }, [point]);
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => searchPlaces(text).then(setItems).catch(() => setItems([])), 200);
    return () => clearTimeout(id);
  }, [text, open]);

  return (
    <div className="search">
      <label>
        {label}
        <div className="searchrow">
          <input value={text} placeholder={t(lang, 'searchPlaceholder')} autoComplete="off"
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => { setText(e.target.value); setOpen(true); }} />
          <button type="button" className="iconbtn" title={t(lang, 'myLocation')} aria-label={t(lang, 'myLocation')} onClick={onLocate}>◎</button>
          <button type="button" className={picking ? 'iconbtn on' : 'iconbtn'} title={t(lang, 'pickOnMap')} aria-label={t(lang, 'pickOnMap')} onClick={onPick}>⌖</button>
        </div>
      </label>
      {open && items.length > 0 && (
        <ul className="results" role="listbox">
          {items.map((p) => (
            <li key={p.id} role="option" onMouseDown={(e) => { e.preventDefault(); onSelect({ lat: p.lat, lng: p.lng, name: p.name }); setOpen(false); }}>
              <b>{p.name}</b> <small>{p.kind}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
