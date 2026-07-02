import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import {
  IconHistory, IconLaunch, IconSchedule, IconCatalog, IconUsers,
  IconAudit, IconSettings, IconServer, IconUser, IconKey, IconLogout,
} from './icons.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  // Siempre arranca colapsado (se puede expandir en la sesión, pero no se recuerda).
  const [collapsed, setCollapsed] = useState(true);

  const canLaunch = user && ['operator', 'admin'].includes(user.role);
  const isAdmin = user?.role === 'admin';

  const items = [
    { to: '/jobs', label: 'Historial', Icon: IconHistory, show: true },
    { to: '/launch', label: 'Lanzar restore', Icon: IconLaunch, show: canLaunch },
    { to: '/schedules', label: 'Programadas', Icon: IconSchedule, show: canLaunch },
    { to: '/catalog', label: 'Catálogo', Icon: IconCatalog, show: isAdmin },
    { to: '/users', label: 'Usuarios', Icon: IconUsers, show: isAdmin },
    { to: '/audit', label: 'Auditoría', Icon: IconAudit, show: isAdmin },
    { to: '/settings', label: 'Ajustes', Icon: IconSettings, show: isAdmin },
  ].filter((i) => i.show);

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <span className="nav-icon"><IconServer /></span>
            <span className="brand-text">db-refresh</span>
          </div>
          <button
            className="collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            data-tooltip={collapsed ? 'Expandir' : 'Colapsar'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="nav">
          {items.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} aria-label={label} data-tooltip={label}>
              <span className="nav-icon"><Icon /></span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="userinfo" data-tooltip={`${user?.email} · ${user?.role}`}>
            <span className="nav-icon"><IconUser /></span>
            <span className="nav-label user-meta">
              <span className="user-email">{user?.email}</span>
              <span className="role">{user?.role}</span>
            </span>
          </div>
          <button className="foot-btn" onClick={() => setShowPwd(true)} aria-label="Cambiar contraseña" data-tooltip="Cambiar contraseña">
            <span className="nav-icon"><IconKey /></span>
            <span className="nav-label">Contraseña</span>
          </button>
          <button className="foot-btn" onClick={doLogout} aria-label="Cerrar sesión" data-tooltip="Cerrar sesión">
            <span className="nav-icon"><IconLogout /></span>
            <span className="nav-label">Salir</span>
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  );
}
