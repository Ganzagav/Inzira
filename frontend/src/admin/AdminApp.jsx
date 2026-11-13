import { useCallback, useEffect, useState } from 'react';
import Login from '../portal/Login.jsx';
import SignedOut from '../portal/SignedOut.jsx';
import Shell from '../portal/Shell.jsx';
import AccountTab from '../portal/AccountTab.jsx';
import ActivityTab from '../portal/ActivityTab.jsx';
import NetworkPanel from './NetworkPanel.jsx';
import UsersTab from './UsersTab.jsx';
import DevicesTab from './DevicesTab.jsx';
import AuditTab from './AuditTab.jsx';
import useSession from '../portal/useSession.js';
import { listIncidents } from '../portal/portalApi.js';

const TABS = [['overview', 'Overview'], ['officers', 'Officers'], ['devices', 'Devices'], ['network', 'Road network'], ['audit', 'Audit log'], ['account', 'Account']];

export default function AdminApp() {
  const s = useSession('admin');
  const [tab, setTab] = useState('overview');
  const [active, setActive] = useState([]);

  const refresh = useCallback(() => listIncidents('active').then(setActive).catch(() => {}), []);
  useEffect(() => {
    if (!s.user) return undefined;
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [s.user, refresh]);

  if (s.checking) return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  if (s.signedOut) return <SignedOut portal="admin" reason={s.signedOut} onSignIn={s.backToLogin} />;
  if (!s.user) return <Login portal="admin" onLogin={s.login} />;

  return (
    <Shell portal="admin" title="Administration portal" user={s.user} tabs={TABS} tab={tab} setTab={setTab} onLogout={() => s.logout('manual')}>
      <div className="page">
        {tab === 'overview' && <ActivityTab user={s.user} active={active} onChange={refresh} />}
        {tab === 'officers' && <UsersTab me={s.user} />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'network' && <NetworkPanel />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'account' && <AccountTab user={s.user} />}
      </div>
    </Shell>
  );
}
