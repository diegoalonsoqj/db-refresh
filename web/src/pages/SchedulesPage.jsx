import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useList } from '../hooks/useList.js';
import Modal from '../components/Modal.jsx';
import { IconClose } from '../components/icons.jsx';

const empty = { instanceRef: '', bucketRef: '', cronExpr: '0 3 * * *', mapping: [{ backupFile: '', targetDb: '' }], isActive: true };

export default function SchedulesPage() {
  const navigate = useNavigate();
  const { data: schedules, error, reload } = useList('/schedules');
  const { data: instances } = useList('/instances');
  const { data: buckets } = useList('/buckets');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const nameInstance = (id) => (instances ?? []).find((i) => i.id === id)?.instance_name ?? id?.slice(0, 8);
  const nameBucket = (id) => (buckets ?? []).find((b) => b.id === id)?.bucket_name ?? id?.slice(0, 8);

  const openNew = () => { setForm({ ...empty, mapping: [{ backupFile: '', targetDb: '' }] }); setEditing({}); setFormErr(null); };
  const openEdit = (s) => {
    setForm({
      instanceRef: s.instance_ref, bucketRef: s.bucket_ref, cronExpr: s.cron_expr,
      mapping: s.mapping?.length ? s.mapping : [{ backupFile: '', targetDb: '' }], isActive: s.is_active,
    });
    setEditing(s); setFormErr(null);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Owner del import (importUser): solo PostgreSQL.
  const engineOf = (instances ?? []).find((i) => i.id === form.instanceRef)?.engine;
  const isPg = engineOf === 'postgres';
  const isMssql = engineOf === 'sqlserver';

  const setMap = (idx, k, v) => setForm((f) => ({ ...f, mapping: f.mapping.map((m, i) => (i === idx ? { ...m, [k]: v } : m)) }));
  const addMap = () => setForm((f) => ({ ...f, mapping: [...f.mapping, { backupFile: '', targetDb: '' }] }));
  const delMap = (idx) => setForm((f) => ({ ...f, mapping: f.mapping.filter((_, i) => i !== idx) }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const mapping = form.mapping
      .filter((m) => m.backupFile && m.targetDb)
      .map(({ importUser, fixOrphans, dropViaSql, ...m }) => ({
        ...m,
        ...(isPg && importUser ? { importUser } : {}),
        ...(isMssql && fixOrphans ? { fixOrphans: true } : {}),
        ...(isPg && dropViaSql ? { dropViaSql: true } : {}),
      }));
    const body = { ...form, mapping };
    try {
      if (editing.id) await api.put(`/schedules/${editing.id}`, body);
      else await api.post('/schedules', body);
      setEditing(null); await reload();
    } catch (err) { setFormErr(err.details ? `${err.message}` : err.message); }
    finally { setBusy(false); }
  };

  const remove = async (s) => {
    if (!confirm('¿Eliminar esta programación?')) return;
    try { await api.del(`/schedules/${s.id}`); await reload(); }
    catch (err) { alert(err.message); }
  };

  const run = async (s) => {
    try { const d = await api.post(`/schedules/${s.id}/run`); navigate(`/jobs/${d.jobId}`); }
    catch (err) { alert(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!schedules) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Restauraciones programadas</h2>
        <button className="btn primary small" onClick={openNew} disabled={!instances?.length || !buckets?.length}>+ Nueva</button>
      </div>
      <table className="table">
        <thead><tr><th>Instancia</th><th>Bucket</th><th>Cron</th><th>BD</th><th>Activo</th><th>Última</th><th /></tr></thead>
        <tbody>
          {schedules.length === 0 && <tr><td colSpan="7" className="muted">Sin programaciones.</td></tr>}
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>{nameInstance(s.instance_ref)}</td>
              <td className="mono small">{nameBucket(s.bucket_ref)}</td>
              <td className="mono">{s.cron_expr}</td>
              <td>{s.mapping?.length ?? 0}</td>
              <td><span className={`pill ${s.is_active ? 'on' : ''}`}>{s.is_active ? 'sí' : 'no'}</span></td>
              <td className="muted small">{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : '—'}</td>
              <td className="actions">
                <button className="btn ghost small" onClick={() => run(s)}>Ejecutar</button>
                <button className="btn ghost small" onClick={() => openEdit(s)}>Editar</button>
                <button className="btn ghost small" onClick={() => remove(s)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <Modal wide title={editing.id ? 'Editar programación' : 'Nueva programación'} onClose={() => setEditing(null)}>
          <form className="stack" onSubmit={save}>
            <label>Instancia
              <select value={form.instanceRef} onChange={set('instanceRef')} required>
                <option value="">— elegir —</option>
                {(instances ?? []).map((i) => <option key={i.id} value={i.id}>{i.project_id} / {i.instance_name} ({i.engine})</option>)}
              </select>
            </label>
            <label>Bucket
              <select value={form.bucketRef} onChange={set('bucketRef')} required>
                <option value="">— elegir —</option>
                {(buckets ?? []).map((b) => <option key={b.id} value={b.id}>{b.bucket_name} · {b.project_id}</option>)}
              </select>
            </label>
            <label>Expresión cron<input className="mono" value={form.cronExpr} onChange={set('cronExpr')} placeholder="0 3 * * *" required /></label>

            <div>
              <div className="row between">
                <span className="muted small">Mapping backup → BD destino</span>
                <button type="button" className="btn ghost small" onClick={addMap}>+ fila</button>
              </div>
              {form.mapping.map((m, idx) => (
                <div className="row gap" key={idx} style={{ marginTop: '.4rem' }}>
                  <input className="mono" style={{ flex: 1 }} placeholder="dump.sql" value={m.backupFile} onChange={(e) => setMap(idx, 'backupFile', e.target.value)} />
                  <span className="muted">→</span>
                  <input className="mono" style={{ flex: 1 }} placeholder="mi_bd" value={m.targetDb} onChange={(e) => setMap(idx, 'targetDb', e.target.value)} />
                  {isMssql && (
                    <label className="checkline small" title="Tras restaurar, remapea los usuarios de BD a su login">
                      <input type="checkbox" checked={!!m.fixOrphans} onChange={(e) => setMap(idx, 'fixOrphans', e.target.checked)} />
                      Huérfanos
                    </label>
                  )}
                  {isPg && (
                    <input className="mono" style={{ flex: 1 }} placeholder="owner (opc.)" title="Usuario con el que se importa (PostgreSQL)" value={m.importUser ?? ''} onChange={(e) => setMap(idx, 'importUser', e.target.value)} />
                  )}
                  {isPg && (
                    <label className="checkline small" title="Borra la BD existente por SQL con la credencial de la instancia (para BD cuyo owner no es cloudsqlsuperuser). Requiere la conexión SQL de la instancia">
                      <input type="checkbox" checked={!!m.dropViaSql} onChange={(e) => setMap(idx, 'dropViaSql', e.target.checked)} />
                      Borrar por SQL
                    </label>
                  )}
                  <button type="button" className="btn ghost small icon-btn" onClick={() => delMap(idx)} disabled={form.mapping.length === 1} aria-label="Quitar fila"><IconClose /></button>
                </div>
              ))}
            </div>

            <label className="checkline">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Activo
            </label>
            {formErr && <div className="alert error">{formErr}</div>}
            <div className="row gap">
              <button className="btn primary" disabled={busy}>Guardar</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
