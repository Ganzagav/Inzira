export const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

let portal = 'police';
export const setPortal = (p) => { portal = p; };       // each portal page calls this once
const tokenKey = () => `inzira_token_${portal}`;
export const tokenStore = {
  get: () => sessionStorage.getItem(tokenKey()),
  set: (t) => sessionStorage.setItem(tokenKey(), t),
  clear: () => sessionStorage.removeItem(tokenKey()),
};

export async function req(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && tokenStore.get()) headers.Authorization = `Bearer ${tokenStore.get()}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (auth && res.status === 401) window.dispatchEvent(new Event('inzira-unauthorized'));
    throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  }
  return data;
}

// ---- public ----
export const getMeta = () => req('/api/meta');
export const searchPlaces = (q) => req(`/api/places/search?q=${encodeURIComponent(q)}`);
export const placeNear = (lat, lng) => req(`/api/places/near?lat=${lat}&lng=${lng}`);
export const getNetwork = () => req('/api/network');
export const getProbes = () => req('/api/probes/recent');
export const getRoute = (from, to, avoid) =>
  req(`/api/route?from_lat=${from.lat}&from_lng=${from.lng}&to_lat=${to.lat}&to_lng=${to.lng}${avoid ? '&avoid_unpaved=1' : ''}`);
export const postPublicProbe = (body) => req('/api/probes/public', { method: 'POST', body });
