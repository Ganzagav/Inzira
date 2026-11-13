import { useEffect, useState } from 'react';
import Logo from '../shared/Logo.jsx';

// Shown after signing out: sends people back to the public route planner.
export default function SignedOut({ portal, reason, onSignIn }) {
  const [left, setLeft] = useState(reason === 'manual' ? 8 : null);
  useEffect(() => {
    if (left === null) return undefined;
    if (left <= 0) { window.location.href = '/'; return undefined; }
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  return (
    <div className="loginwrap" data-portal={portal}>
      <div className="logincard center">
        <Logo size={56} />
        <h2>{reason === 'expired' ? 'Your session has ended' : 'You have been signed out'}</h2>
        <p className="muted">{reason === 'expired'
          ? 'For your security you were signed out. Please sign in again to continue.'
          : 'Thank you. Your session has been closed on this device.'}</p>
        <a className="primary linkbtn" href="/">Open the route planner</a>
        <button className="ghost" onClick={onSignIn}>Sign in again</button>
        {left !== null && left > 0 && (
          <p className="muted small">Opening the route planner in {left} s. <button className="textbtn" onClick={() => setLeft(null)}>Stay here</button></p>
        )}
      </div>
    </div>
  );
}
