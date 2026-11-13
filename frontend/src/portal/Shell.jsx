import Logo from '../shared/Logo.jsx';

// Header + tabs shared by both portals.
export default function Shell({ portal, title, user, tabs, tab, setTab, onLogout, children }) {
  return (
    <div className="app" data-portal={portal}>
      <header className="top">
        <div className="brand"><Logo size={38} /><div><h1>Inzira</h1><p>{title}</p></div></div>
        <nav className="tabs" aria-label="sections">
          {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <a className="toplink" href="/" title="Open the public route planner">Route planner ↗</a>
        <div className="who"><b>{user.full_name}</b><small>{user.station || user.role}</small></div>
        <button className="ghost" onClick={onLogout}>Sign out</button>
      </header>
      {children}
    </div>
  );
}
