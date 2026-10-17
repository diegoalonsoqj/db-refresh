import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { DATE_PRESETS, presetRange } from '../lib/dateRange.js';

const sameDay = (a, b) => a.toDateString() === b.toDateString();
const fmt = (d) => d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Con poco ancho se muestra un solo mes. */
function useMonths() {
  const query = '(max-width: 720px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow ? 1 : 2;
}

/**
 * Calendario de rango: el primer clic marca el inicio y el segundo el fin (en
 * cualquier orden; dos clics en el mismo día = solo ese día). Los atajos aplican al
 * instante. Se carga diferido desde DateRangeFilter.
 */
export default function DateRangePopover({ from, to, alignRight, maxHeight, onApply, onCancel }) {
  const months = useMonths();
  const [draft, setDraft] = useState(from ? { from, to: to ?? from } : undefined);
  // Primer clic del rango en curso (null = el próximo clic empieza un rango nuevo).
  const [anchor, setAnchor] = useState(null);
  const today = new Date();

  const pick = (day) => {
    if (!anchor) {
      setAnchor(day);
      setDraft({ from: day, to: day });
      return;
    }
    setDraft(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
    setAnchor(null);
  };

  const status = anchor
    ? 'Elige el día final (o el mismo día)'
    : draft?.from && draft.to && !sameDay(draft.from, draft.to)
      ? `${fmt(draft.from)} – ${fmt(draft.to)}`
      : draft?.from ? fmt(draft.from) : 'Elige el día inicial';

  return (
    <div className={`date-range-popover${alignRight ? ' right' : ''}`} style={{ maxHeight }} role="dialog" aria-label="Rango de fechas">
      <div className="date-range-presets">
        {DATE_PRESETS.map((p) => (
          <button key={p.key} type="button" className="btn small" onClick={() => onApply(presetRange(p.key))}>{p.label}</button>
        ))}
      </div>
      <div className="date-range-calendar">
        <DayPicker
          mode="range"
          selected={draft}
          onSelect={(_range, day) => pick(day)}
          numberOfMonths={months}
          defaultMonth={draft?.from ?? new Date(today.getFullYear(), today.getMonth() - (months - 1), 1)}
          locale={es}
          disabled={{ after: today }}
          showOutsideDays
        />
        <div className="date-range-footer">
          <span className="muted">{status}</span>
          <div className="date-range-actions">
            {anchor && (
              <button type="button" className="btn small" onClick={() => onApply({ from: anchor })}>
                Desde el {fmt(anchor)} en adelante
              </button>
            )}
            <button type="button" className="btn small" onClick={onCancel}>Cancelar</button>
            <button type="button" className="btn small primary" disabled={!draft?.from}
              onClick={() => onApply({ from: draft?.from, to: draft?.to })}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
