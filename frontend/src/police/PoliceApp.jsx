import { useCallback, useEffect, useState } from 'react';
import Login from '../portal/Login.jsx';
import SignedOut from '../portal/SignedOut.jsx';
import Shell from '../portal/Shell.jsx';
import AccountTab from '../portal/AccountTab.jsx';
import ActivityTab from '../portal/ActivityTab.jsx';
import ReportTab from './ReportTab.jsx';
import useSession from '../portal/useSession.js';
import { listIncidents } from '../portal/portalApi.js';

const TABS = [['report', 'Report incident'], ['incidents', 'Incidents'], ['account', 'Account']];

export default function PoliceApp() {
  const s = useSession('officer');
  const [tab, setTab] = useState('report');
  const [active, setActive] = useState([]);

  const refresh = useCallback(() => listIncidents('active').then(setActive).catch(() => {}), []);
  useEffect(() => {
    if (!s.user) return undefined;
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [s.user, refresh]);

  if (s.checking) return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  if (s.signedOut) return <SignedOut portal="police" reason={s.signedOut} onSignIn={s.backToLogin} />;
  if (!s.user) return <Login portal="police" onLogin={s.login} />;

  return (
    <Shell portal="police" title="Traffic police portal" user={s.user} tabs={TABS} tab={tab} setTab={setTab} onLogout={() => s.logout('manual')}>
      {tab === 'report' && <ReportTab active={active} onDone={refresh} />}
      {tab === 'incidents' && <div className="page"><ActivityTab user={s.user} active={active} onChange={refresh} showStats={false} /></div>}
      {tab === 'account' && <div className="page"><AccountTab user={s.user} /></div>}
    </Shell>
  );
}
