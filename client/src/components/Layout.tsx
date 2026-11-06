import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useMe } from '../queries';
import { initials } from './SharePicker';
import { BacklogIcon, CalendarIcon, HistoryIcon, ShieldIcon, TodayIcon } from './icons';

const links = [
  { to: '/', label: 'Today', icon: <TodayIcon />, end: false },
  { to: '/calendar', label: 'Calendar', icon: <CalendarIcon />, end: true },
  { to: '/backlog', label: 'Backlog', icon: <BacklogIcon />, end: true },
  { to: '/history', label: 'History', icon: <HistoryIcon />, end: true },
];

export function Layout() {
  const { pathname } = useLocation();
  const me = useMe();

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Questlog</span>
        <Link to="/account" className="topbar__user" aria-label={`Account: ${me.displayName}`}>
          <span className="avatar" aria-hidden>
            {initials(me.displayName)}
          </span>
          {me.displayName}
        </Link>
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
          {me.isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>
              <ShieldIcon />
              <span>Admin</span>
            </NavLink>
          )}
          <NavLink to="/account" className={({ isActive }) => `nav__link nav__user${isActive ? ' is-active' : ''}`}>
            <span className="avatar" aria-hidden>
              {initials(me.displayName)}
            </span>
            <span>{me.displayName}</span>
          </NavLink>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
