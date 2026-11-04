import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../api';
import { useMe } from '../queries';
import { initials } from './SharePicker';
import { BacklogIcon, CalendarIcon, HistoryIcon, LogoutIcon, TodayIcon } from './icons';

const links = [
  { to: '/', label: 'Today', icon: <TodayIcon />, end: false },
  { to: '/calendar', label: 'Calendar', icon: <CalendarIcon />, end: true },
  { to: '/backlog', label: 'Backlog', icon: <BacklogIcon />, end: true },
  { to: '/history', label: 'History', icon: <HistoryIcon />, end: true },
];

export function Layout() {
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const me = useMe();
  const signOut = async () => {
    await api.logout();
    qc.clear();
    qc.setQueryData(['me'], { signedIn: false });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Questlog</span>
        <span className="topbar__user">
          <span className="avatar" aria-hidden>
            {initials(me.displayName)}
          </span>
          {me.displayName}
        </span>
        <button className="icon-btn" onClick={signOut} aria-label="Sign out">
          <LogoutIcon />
        </button>
      </header>

      <nav className="nav" aria-label="Main">
        <span className="brand nav__brand">Questlog</span>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `nav__link${isActive || (l.to === '/' && pathname.startsWith('/day/')) ? ' is-active' : ''}`
            }
          >
            {l.icon}
            <span>{l.label}</span>
          </NavLink>
        ))}
        <div className="nav__footer">
          <span className="nav__user">
            <span className="avatar" aria-hidden>
              {initials(me.displayName)}
            </span>
            {me.displayName}
          </span>
          <button className="nav__link" onClick={signOut}>
            <LogoutIcon />
            <span>Sign out</span>
          </button>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
