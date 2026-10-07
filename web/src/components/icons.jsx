// Iconos de línea de lucide-react (mismo set que db-keeper). Heredan el color
// del texto (currentColor). Se envuelven con nombres propios para que las
// pantallas no dependan directamente de la librería.
import {
  Activity, ArrowLeft, ArrowUp, CalendarClock, CircleCheck, CircleX, Eye, LayoutDashboard, ChevronDown, ChevronLeft, CirclePlay, Database,
  FileCode2, Folder, History, KeyRound, Link2, Lock, LogOut, Moon, Pencil, Play, PlugZap, Plus,
  RefreshCw, ScrollText, Server, Settings, Star, Sun, Trash2, TriangleAlert, Unlink, User, Users, X,
} from 'lucide-react';

const icon = (Lucide) => function Icon({ size = 18 }) {
  return <Lucide size={size} strokeWidth={1.75} aria-hidden="true" />;
};

export const IconHistory = icon(History);
export const IconLaunch = icon(CirclePlay);
export const IconSchedule = icon(CalendarClock);
export const IconCatalog = icon(Database);
export const IconUsers = icon(Users);
export const IconAudit = icon(ScrollText);
export const IconSettings = icon(Settings);
export const IconServer = icon(Server);
export const IconUser = icon(User);
export const IconKey = icon(KeyRound);
export const IconLogout = icon(LogOut);
export const IconChevronLeft = icon(ChevronLeft);
export const IconChevronDown = icon(ChevronDown);
export const IconClose = icon(X);
export const IconArrowLeft = icon(ArrowLeft);
export const IconArrowUp = icon(ArrowUp);
export const IconRefresh = icon(RefreshCw);
export const IconFolder = icon(Folder);
export const IconAlert = icon(TriangleAlert);
export const IconLock = icon(Lock);
export const IconSun = icon(Sun);
export const IconMoon = icon(Moon);
export const IconEdit = icon(Pencil);
export const IconDelete = icon(Trash2);
export const IconPlus = icon(Plus);
export const IconPlay = icon(Play);
export const IconView = icon(Eye);
export const IconDashboard = icon(LayoutDashboard);
export const IconSuccess = icon(CircleCheck);
export const IconFailed = icon(CircleX);
export const IconActivity = icon(Activity);
export const IconPlug = icon(PlugZap);
export const IconLink = icon(Link2);
export const IconUnlink = icon(Unlink);
export const IconScript = icon(FileCode2);
export const IconStar = icon(Star);

// Logo de la app (mismo dibujo que public/favicon.svg): BD + flecha de refresco
// sobre un cuadrado con el color primario.
export const BrandLogo = ({ size = 24 }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="brand-logo">
    <rect width="32" height="32" rx="7" style={{ fill: 'var(--primary)' }} />
    <g fill="none" style={{ stroke: 'var(--on-primary)' }} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="13" cy="8.5" rx="7" ry="2.8" />
      <path d="M6 8.5v13c0 1.55 3.13 2.8 7 2.8M20 8.5v5M6 15c0 1.55 3.13 2.8 7 2.8" />
      <path d="M27.5 21a5.5 5.5 0 1 1-1.6-3.9M26.4 13.8v3.6h-3.6" />
    </g>
  </svg>
);
