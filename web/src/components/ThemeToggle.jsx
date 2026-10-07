import { useTheme } from '../theme/ThemeContext.jsx';
import { IconMoon, IconSun } from './icons.jsx';

/** Alterna claro/oscuro con la paleta actual (la misma preferencia que Ajustes > Apariencia). */
export default function ThemeToggle() {
  const { isDark, setMode } = useTheme();
  const label = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  return (
    <button type="button" className="header-icon-btn" onClick={() => setMode(isDark ? 'light' : 'dark')} title={label} aria-label={label}>
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
