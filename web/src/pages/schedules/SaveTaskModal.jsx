import { useState } from 'react';
import { api } from '../../api/client.js';
import { FormModal } from '../../components/ui.jsx';
import { suggestPattern } from '../../lib/schedule.js';

/**
 * «Guardar como tarea» desde Lanzar restore: guarda la selección actual
 * (instancia, carpeta y mapping) como tarea, sin lanzar nada. Por defecto cada
 * backup pasa a «último por patrón» para que la tarea sirva en ejecuciones
 * futuras; se puede dejar el archivo concreto.
 */
export default function SaveTaskModal({ instance, bucketId, bucketPath, rows, skipSql, onClose, onSaved }) {
  const [name, setName] = useState(rows.length === 1 ? `${rows[0].targetDb.trim()} · ${instance.instance_name}` : '');
  const [useLatest, setUseLatest] = useState(true);
  const [patterns, setPatterns] = useState(() => rows.map((r) => suggestPattern(r.backupFile)));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    const mapping = rows.map((r, i) => ({
      ...(useLatest ? { source: 'latest', pattern: patterns[i].trim() } : { source: 'fixed', backupFile: r.backupFile }),
      targetDb: r.targetDb.trim(),
      ...(r.importUser ? { importUser: r.importUser } : {}),
      ...(r.dropViaSql ? { dropViaSql: true } : {}),
      ...(r.fixOrphans ? { fixOrphans: true, ...(r.dbOwner ? { dbOwner: r.dbOwner } : {}) } : {}),
    }));
    try {
      onSaved(await api.post('/schedules', {
        name, instanceRef: instance.id, bucketRef: bucketId, bucketPath, mapping, skipSqlOnFailure: skipSql,
      }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <FormModal title="Guardar como tarea" onClose={onClose} onSubmit={save} busy={busy} error={error} submitLabel="Guardar tarea">
      <label className="full">Nombre de la tarea
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ej. PaynovaBD homologación (diario)" autoFocus required />
        <span className="field-hint">No se lanza nada: la tarea queda sin programar. Prográmala después en Programadas.</span>
      </label>
      <label className="checkline full">
        <input type="checkbox" checked={useLatest} onChange={(e) => setUseLatest(e.target.checked)} />
        Usar en cada ejecución el último backup que encaje con el patrón (recomendado para tareas recurrentes)
      </label>
      <div className="full table-scroll">
        <table className="table">
          <thead><tr><th>{useLatest ? 'Patrón' : 'Archivo'}</th><th>BD destino</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.backupFile}>
                <td>
                  {useLatest ? (
                    <div className="stack-tight">
                      <input className="mono" value={patterns[i]} required
                        onChange={(e) => setPatterns((ps) => ps.map((p, j) => (j === i ? e.target.value : p)))} />
                      <span className="field-hint">Seleccionado hoy: <span className="mono">{r.backupFile}</span></span>
                    </div>
                  ) : <span className="mono small">{r.backupFile}</span>}
                </td>
                <td className="mono">{r.targetDb.trim()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small full">Carpeta: <span className="mono">{bucketPath}</span></div>
    </FormModal>
  );
}
