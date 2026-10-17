import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { IconCalendar, IconClose } from './icons.jsx';
import { formatDay, parseDay } from '../lib/dateRange.js';

// El calendario (react-day-picker) solo se descarga al abrirlo.
const DateRangePopover = lazy(() => import('./DateRangePopover.jsx'));

const fmt = (v) => parseDay(v)?.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }) ?? '';

/**
 * Filtro de fechas en un solo campo (como db-keeper): abre un calendario donde se
 * marca inicio y fin, o un atajo (hoy, últimos 7/30 días, este mes, mes anterior).
 * `from`/`to`: `AAAA-MM-DD` (vacío = sin límite).
 */
export default function DateRangeFilter({ label = 'Fecha', from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  // Alto disponible bajo el campo: el calendario hace scroll interno si no cabe.
  const [maxHeight, setMaxHeight] = useState(undefined);
  const wrapRef = useRef(null);

  // Cerrar con clic fuera o Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    // Si el campo está en la mitad derecha, el calendario se abre hacia la izquierda.
    setAlignRight(Boolean(rect && rect.left > window.innerWidth / 2));
    setMaxHeight(rect ? Math.max(240, window.innerHeight - rect.bottom - 16) : undefined);
    setOpen((o) => !o);
  };

  const text = from && to
    ? (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`)
    : from ? `Desde ${fmt(from)}` : to ? `Hasta ${fmt(to)}` : 'Cualquier fecha';

  return (
    <div className="date-range" ref={wrapRef}>
      <span className="date-range-label">{label}</span>
      <div className="date-range-field">
        <button type="button" className={`date-range-trigger${from || to ? ' has-value' : ''}`}
          aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
          <IconCalendar size={15} />
          <span>{text}</span>
        </button>
        {(from || to) && (
          <button type="button" className="date-range-clear" title="Quitar fechas" aria-label="Quitar fechas"
            onClick={() => onChange({ from: '', to: '' })}>
            <IconClose size={14} />
          </button>
        )}
      </div>
      {open && (
        <Suspense fallback={<div className={`date-range-popover${alignRight ? ' right' : ''}`}>Cargando…</div>}>
          <DateRangePopover
            from={parseDay(from)}
            to={parseDay(to)}
            alignRight={alignRight}
            maxHeight={maxHeight}
            onApply={(r) => {
              onChange({ from: r.from ? formatDay(r.from) : '', to: r.to ? formatDay(r.to) : '' });
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
