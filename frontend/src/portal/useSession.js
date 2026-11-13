import { useCallback, useEffect, useState } from 'react';
import { me } from './portalApi.js';
import { tokenStore } from '../shared/api.js';

// Keeps the login state of one portal. `role` is the only role allowed in this portal.
export default function useSession(role) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(tokenStore.get()));
  const [signedOut, setSignedOut] = useState(null);   // null | 'manual' | 'expired'

  useEffect(() => {
    if (!tokenStore.get()) return;
    me().then((r) => (r.user.role === role ? setUser(r.user) : tokenStore.clear()))
      .catch(() => tokenStore.clear()).finally(() => setChecking(false));
  }, [role]);

  const logout = useCallback((reason = 'manual') => { tokenStore.clear(); setUser(null); setSignedOut(reason); }, []);
  useEffect(() => { // token expired or account disabled
    const h = () => logout('expired');
    window.addEventListener('inzira-unauthorized', h);
    return () => window.removeEventListener('inzira-unauthorized', h);
  }, [logout]);

  return { user, checking, signedOut, logout, login: (u) => { setSignedOut(null); setUser(u); }, backToLogin: () => setSignedOut(null) };
}
