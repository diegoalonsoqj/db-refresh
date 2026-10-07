import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

// Paletas disponibles. Los colores reales viven en styles.css; `swatch`
// (fondo, tarjeta, primario) solo se usa para la vista previa en Ajustes.
export const THEMES = [
  { id: 'blue', label: 'Azul', description: 'Tema de la marca', swatch: { dark: ['#0f1420', '#171e2e', '#4f7cff'], light: ['#f4f6fb', '#ffffff', '#3563e9'] } },
  { id: 'violet', label: 'Violeta', description: 'Índigo profundo', swatch: { dark: ['#12101c', '#1a1728', '#8b6cff'], light: ['#f6f5fc', '#ffffff', '#6d4fe0'] } },
  { id: 'emerald', label: 'Esmeralda', description: 'Verde sobrio', swatch: { dark: ['#0d1513', '#141f1c', '#2fbf8a'], light: ['#f3f7f5', '#ffffff', '#0f8a5f'] } },
];

export const MODES = ['dark', 'light', 'system'];

const DEFAULT_PREF = { theme: 'blue', mode: 'dark' };
// Último tema aplicado en este navegador: lo lee public/theme-init.js antes del
// primer pintado (también en el login, cuando aún no hay usuario).
const LAST_KEY = 'dbrefresh.appearance';
const userKey = (user) => `${LAST_KEY}:${user.id}`;

function readPref(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved && THEMES.some((t) => t.id === saved.theme) && MODES.includes(saved.mode)) return saved;
  } catch {
    // storage no disponible o valor corrupto
  }
  return null;
}

function writePref(keys, pref) {
  try {
    for (const k of keys) localStorage.setItem(k, JSON.stringify(pref));
  } catch {
    // sin storage: la preferencia dura solo esta sesión
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [pref, setPref] = useState(() => readPref(LAST_KEY) ?? DEFAULT_PREF);
  const [osDark, setOsDark] = useState(systemDark);

  // Al iniciar sesión, carga la preferencia de ese usuario (si tiene una).
  useEffect(() => {
    if (!user) return;
    const saved = readPref(userKey(user));
    if (saved) {
      setPref(saved);
      writePref([LAST_KEY], saved);
    }
  }, [user]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = pref.mode === 'system' ? osDark : pref.mode === 'dark';

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = pref.theme;
    root.dataset.mode = isDark ? 'dark' : 'light';
    // La barra del navegador (móvil) sigue el color primario del tema.
    const primary = getComputedStyle(root).getPropertyValue('--primary').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primary);
  }, [pref.theme, isDark]);

  const update = useCallback((patch) => {
    setPref((prev) => {
      const next = { ...prev, ...patch };
      writePref(user ? [LAST_KEY, userKey(user)] : [LAST_KEY], next);
      return next;
    });
  }, [user]);

  const value = useMemo(() => ({
    theme: pref.theme,
    mode: pref.mode,
    isDark,
    setTheme: (theme) => update({ theme }),
    setMode: (mode) => update({ mode }),
  }), [pref, isDark, update]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}
