import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import {
  IconDashboard, IconHistory, IconSchedule, IconCatalog, IconUsers,
  IconAudit, IconSettings, IconKey, IconLogout, BrandLogo,
  IconChevronLeft, IconChevronDown, IconLock,
} from './icons.jsx';

const COLLAPSE_KEY = 'dbrefresh.sidebarCollapsed';

const ROLE_LABEL = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Solo lectura',
};

/** Iniciales para el avatar por defecto. */
function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Menú de usuario del header: avatar + nombre/rol, despliega contraseña y salir. */
function UserMenu({ onChangePassword }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Un menú abierto tiene que cerrarse al clickear afuera o con Escape; si no,
  // queda flotando sobre el contenido.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const name = user.full_name || user.email || user.username;

  const doLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="avatar">{initialsOf(name)}</span>
        <span className="user-id">
          <strong>{name}</strong>
          <small>{ROLE_LABEL[user.role] ?? user.role}</small>
        </span>
        <span className={`chevron ${open ? 'up' : ''}`}><IconChevronDown /></span>
      </button>

      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            <strong>{name}</strong>
            <small>{user.email ?? user.username}{user.auth_source === 'ad' ? ' · AD' : ''}</small>
          </div>
          {/* Los usuarios de AD cambian su contraseña en el directorio. */}
          {user.auth_source !== 'ad' && (
            <button
              type="button"
              role="menuitem"
              className="dropdown-item"
              onClick={() => { setOpen(false); onChangePassword(); }}
            >
              <IconKey />
              Cambiar contraseña
            </button>
          )}
          <button type="button" role="menuitem" className="dropdown-item danger" onClick={doLogout}>
            <IconLogout />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [showPwd, setShowPwd] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const canLaunch = user && ['operator', 'admin'].includes(user.role);
  const isAdmin = user?.role === 'admin';

  const items = [
    { to: '/dashboard', label: 'Panel', title: 'Panel', Icon: IconDashboard, show: true },
    { to: '/jobs', label: 'Historial', title: 'Historial de restauraciones', Icon: IconHistory, show: true },
    { to: '/tasks', label: 'Tareas de restore', title: 'Tareas de restore', Icon: IconSchedule, show: canLaunch },
    { to: '/catalog', label: 'Catálogo', title: 'Catálogo GCP', Icon: IconCatalog, show: isAdmin },
    { to: '/credentials', label: 'Credenciales', title: 'Credenciales SQL', Icon: IconLock, show: isAdmin },
    { to: '/users', label: 'Usuarios', Icon: IconUsers, show: isAdmin },
    { to: '/audit', label: 'Auditoría', Icon: IconAudit, show: isAdmin },
    { to: '/settings', label: 'Ajustes', Icon: IconSettings, show: true },
  ].filter((i) => i.show);

  // Título del módulo activo en el header (patrón de db-keeper); /jobs/:id cae en Historial.
  const active = items.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  const pageTitle = active?.title ?? active?.label ?? '';

  const toggleSidebar = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  };

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <BrandLogo />
            <span className="brand-text">DBRefresh</span>
          </div>
        </div>

        <nav className="nav">
          {items.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} aria-label={label} data-tooltip={label}>
              <span className="nav-icon"><Icon /></span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Botón circular montado a caballo del borde derecho: la mitad queda fuera
            del sidebar (mismo patrón que db-keeper / db-profiler). */}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          <IconChevronLeft />
        </button>
      </aside>

      <div className="content">
        <header className="app-header">
          <div className="header-left">
            <h1 className="page-title">{pageTitle}</h1>
          </div>
          <div className="header-right">
            <ThemeToggle />
            <UserMenu onChangePassword={() => setShowPwd(true)} />
          </div>
        </header>

        <main className="app-main">
          <Outlet />
        </main>
      </div>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  );
}
