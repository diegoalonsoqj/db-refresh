import { useState } from 'react';
import { api } from '../../api/client.js';
import { FormModal } from '../../components/ui.jsx';
import {
  DEFAULT_TIMEZONE, WEEKDAYS, buildCron, fmtInZone, parseCron, wallClock,
} from '../../lib/schedule.js';

/** Mañana a las 21:00 (valor inicial de «Una vez»). */
function tomorrowAt21(timezone) {
  const d = new Date(Date.now() + 86400e3);
  return `${wallClock(d.toISOString(), timezone).slice(0, 10)}T21:00`;
}

/**
 * Programación de una tarea (como db-keeper): sin programar | una vez (fecha y
 * hora) | recurrente (diaria / semanal / mensual / cron avanzado), en una zona horaria.
 */
export default function ScheduleModal({ task, onClose, onSaved }) {
  const tz0 = task.timezone || DEFAULT_TIMEZONE;
  const parsed = parseCron(task.cron_expr);
  const [mode, setMode] = useState(task.schedule_mode ?? 'none');
  const [timezone, setTimezone] = useState(tz0);
  const [runAt, setRunAt] = useState(task.schedule_mode === 'once' && task.run_at ? wallClock(task.run_at, tz0) : tomorrowAt21(tz0));
  const [freq, setFreq] = useState(task.schedule_mode === 'recurring' ? parsed.freq : 'daily');
  const [time, setTime] = useState(parsed.time);
  const [weekday, setWeekday] = useState(parsed.weekday);
  const [dom, setDom] = useState(parsed.dom);
  const [advanced, setAdvanced] = useState(task.cron_expr ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const cron = mode === 'recurring' ? buildCron(freq, time, weekday, dom, advanced) : '';

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    const body = mode === 'once' ? { mode, runAt, timezone }
      : mode === 'recurring' ? { mode, cron, timezone } : { mode, timezone };
    try {
      onSaved(await api.put(`/schedules/${task.id}/schedule`, body));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <FormModal title={`Programar · ${task.name}`} onClose={onClose} onSubmit={save} busy={busy} error={error}>
      {task.is_active && task.next_run_at && (
        <div className="form-section full">
          Próxima ejecución actual: <strong>{fmtInZone(task.next_run_at, task.timezone)}</strong> ({task.timezone})
        </div>
      )}
      <label>Programación
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="none">Sin programar</option>
          <option value="once">Una vez (fecha y hora)</option>
          <option value="recurring">Recurrente</option>
        </select>
      </label>
      <label>Zona horaria
        <input className="mono" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder={DEFAULT_TIMEZONE} />
      </label>

      {mode === 'once' && (
        <label className="full">Fecha y hora
          <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} required />
          <span className="field-hint">Hora de {timezone}. Tras ejecutarse, la tarea queda sin programar.</span>
        </label>
      )}

      {mode === 'recurring' && (
        <>
          <label>Frecuencia
            <select value={freq} onChange={(e) => setFreq(e.target.value)}>
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
              <option value="advanced">Avanzada (cron)</option>
            </select>
          </label>
          {freq !== 'advanced' && (
            <label>Hora<input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
          )}
          {freq === 'weekly' && (
            <label>Día de la semana
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((name, d) => <option key={d} value={d}>{name}</option>)}
              </select>
            </label>
          )}
          {freq === 'monthly' && (
            <label>Día del mes
              <input type="number" min={1} max={31} value={dom} onChange={(e) => setDom(Number(e.target.value))} required />
            </label>
          )}
          {freq === 'advanced' && (
            <label className="full">Expresión cron
              <input className="mono" value={advanced} onChange={(e) => setAdvanced(e.target.value)} placeholder="0 21 * * 1-5" required />
              <span className="field-hint">minuto hora día-del-mes mes día-de-la-semana (p.ej. «0 21 * * 1-5» = lunes a viernes a las 21:00).</span>
            </label>
          )}
          <div className="muted small full">cron: <span className="mono">{cron || '—'}</span> · hora de {timezone}</div>
        </>
      )}
    </FormModal>
  );
}
