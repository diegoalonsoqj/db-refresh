import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { FormModal } from '../../components/ui.jsx';
import { IconArrowUp, IconClose, IconFolder, IconPlus, IconRefresh } from '../../components/icons.jsx';
import { pickLatest, suggestPattern } from '../../lib/schedule.js';

// gs://bucket/prefijo de un bucket vinculado.
export function bucketBase(b) {
  const prefix = b?.base_prefix ? `/${String(b.base_prefix).replace(/^\/+|\/+$/g, '')}` : '';
  return b ? `gs://${b.bucket_name}${prefix}` : '';
}

const emptyRow = () => ({ source: 'latest', pattern: '', backupFile: '', targetDb: '', importUser: '', fixOrphans: false, dbOwner: '', dropViaSql: false });

/**
 * Editor de una tarea de restore: qué restaurar (instancia, carpeta del bucket y
 * mapping). Cada fila toma el ÚLTIMO backup que encaje con un patrón (lo normal
 * en tareas recurrentes) o un archivo concreto. La programación va aparte.
 */
export default function TaskModal({ task, instances, onClose, onSaved }) {
  const editing = Boolean(task?.id);
  const [name, setName] = useState(task?.name ?? '');
  const [instanceRef, setInstanceRef] = useState(task?.instance_ref ?? '');
  const [buckets, setBuckets] = useState(null);
  const [bucketRef, setBucketRef] = useState(task?.bucket_ref ?? '');
  const [folder, setFolder] = useState(''); // subcarpeta dentro de la base del bucket ('a/b')
  const [rows, setRows] = useState(task?.mapping?.length
    ? task.mapping.map((m) => ({ ...emptyRow(), ...m, source: m.source ?? 'fixed', pattern: m.pattern ?? '', backupFile: m.backupFile ?? '', importUser: m.importUser ?? '', dbOwner: m.dbOwner ?? '' }))
    : [emptyRow()]);
  const [skipSql, setSkipSql] = useState(Boolean(task?.skip_sql_on_failure));
  const [listing, setListing] = useState(null); // { files, folders } de la carpeta | { error }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const instance = instances.find((i) => i.id === instanceRef);
  const engine = instance?.engine;
  const bucket = (buckets ?? []).find((b) => b.id === bucketRef);
  const base = bucketBase(bucket);
  const bucketPath = base ? [base, folder].filter(Boolean).join('/') : '';

  // Buckets vinculados a la instancia (+ el de la tarea aunque ya no esté vinculado).
  useEffect(() => {
    setBuckets(null);
    setListing(null);
    if (!instanceRef) return;
    api.get(`/instances/${instanceRef}/buckets`).then((list) => {
      let all = list;
      if (task?.bucket_ref && task.instance_ref === instanceRef && !list.some((b) => b.id === task.bucket_ref)) {
        all = [...list, { id: task.bucket_ref, bucket_name: task.bucket_name, base_prefix: task.base_prefix }];
      }
      setBuckets(all);
      if (!all.some((b) => b.id === bucketRef)) {
        const pick = all.find((b) => b.is_default) ?? (all.length === 1 ? all[0] : null);
        setBucketRef(pick?.id ?? '');
      }
    }).catch((e) => { setBuckets([]); setError(e.message); });
  }, [instanceRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir una tarea existente, su carpeta relativa a la base del bucket.
  useEffect(() => {
    if (!bucket) return;
    const b = bucketBase(bucket);
    const saved = editing && task.bucket_ref === bucket.id ? task.bucket_path : null;
    setFolder(saved && saved.startsWith(`${b}/`) ? saved.slice(b.length + 1) : '');
  }, [bucket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = async () => {
    if (!bucketPath) return;
    setLoading(true);
    try {
      setListing(await api.get(`/backups?instanceId=${instanceRef}&bucketPath=${encodeURIComponent(bucketPath)}&method=import`));
    } catch (e) { setListing({ error: e.message }); }
    finally { setLoading(false); }
  };
  // Lista sola al cambiar de carpeta (para la vista previa de los patrones).
  useEffect(() => { setListing(null); if (bucketPath) list(); }, [bucketPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const files = listing?.files ?? null;
  const setRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const setSource = (idx, source) => setRows((rs) => rs.map((r, i) => {
    if (i !== idx) return r;
    if (source === 'latest') return { ...r, source, pattern: r.pattern || suggestPattern(r.backupFile) };
    return { ...r, source, backupFile: r.backupFile || pickLatest(files, r.pattern)?.fileName || '' };
  }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    const isPg = engine === 'postgres';
    const mapping = rows
      .filter((r) => (r.source === 'latest' ? r.pattern.trim() : r.backupFile.trim()) && r.targetDb.trim())
      .map((r) => ({
        source: r.source,
        ...(r.source === 'latest' ? { pattern: r.pattern.trim() } : { backupFile: r.backupFile.trim() }),
        targetDb: r.targetDb.trim(),
        ...(isPg && r.importUser.trim() ? { importUser: r.importUser.trim() } : {}),
        ...(isPg && r.dropViaSql ? { dropViaSql: true } : {}),
        ...(engine === 'sqlserver' && r.fixOrphans ? { fixOrphans: true, ...(r.dbOwner.trim() ? { dbOwner: r.dbOwner.trim() } : {}) } : {}),
      }));
    const body = { name, instanceRef, bucketRef, bucketPath, mapping, skipSqlOnFailure: skipSql };
    try {
      onSaved(editing ? await api.put(`/schedules/${task.id}`, body) : await api.post('/schedules', body));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const segments = folder ? folder.split('/') : [];

  return (
    <FormModal size="lg" title={editing ? 'Editar tarea' : 'Nueva tarea de restore'} onClose={onClose} onSubmit={save} busy={busy} error={error}>
      <label className="full">Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ej. PaynovaBD homologación (diario)" autoFocus required />
      </label>
      <label>Instancia
        <select value={instanceRef} onChange={(e) => setInstanceRef(e.target.value)} required>
          <option value="">— elegir —</option>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.project_id} / {i.instance_name} ({i.engine})</option>)}
        </select>
      </label>
      <label>Bucket
        <select value={bucketRef} onChange={(e) => setBucketRef(e.target.value)} disabled={!buckets?.length} required>
          <option value="">{!instanceRef ? '— elige antes la instancia —' : buckets === null ? 'Cargando…' : buckets.length ? '— elegir —' : '(sin buckets vinculados)'}</option>
          {(buckets ?? []).map((b) => <option key={b.id} value={b.id}>{b.bucket_name}{b.base_prefix ? `/${b.base_prefix}` : ''}{b.is_default ? ' (default)' : ''}</option>)}
        </select>
      </label>

      {base && (
        <div className="full task-folder">
          <div className="card-title-row">
            <span className="field-label">Carpeta de los backups</span>
            <button type="button" className="btn small" onClick={list} disabled={loading}><IconRefresh size={15} /> {loading ? 'Listando…' : 'Recargar'}</button>
          </div>
          <div className="breadcrumb">
            <button type="button" className="crumb mono" onClick={() => setFolder('')} disabled={!folder}>{base}</button>
            {segments.map((seg, i) => (
              <span key={i} className="crumb-item">
                <span className="muted">/</span>
                <button type="button" className="crumb mono" onClick={() => setFolder(segments.slice(0, i + 1).join('/'))} disabled={i === segments.length - 1}>{seg}</button>
              </span>
            ))}
          </div>
          {(segments.length > 0 || listing?.folders?.length > 0) && (
            <ul className="folder-list">
              {segments.length > 0 && (
                <li><button type="button" className="btn small" onClick={() => setFolder(segments.slice(0, -1).join('/'))}><IconArrowUp size={15} /> Subir</button></li>
              )}
              {(listing?.folders ?? []).map((f) => (
                <li key={f}><button type="button" className="btn small mono" onClick={() => setFolder([...segments, f].join('/'))}><IconFolder size={15} /> {f}</button></li>
              ))}
            </ul>
          )}
          {listing?.error && <div className="alert warn small">No se pudo listar la carpeta: {listing.error}</div>}
          {files && <span className="field-hint">{files.length} backup(s) en esta carpeta. Se usan los de este nivel (no los de subcarpetas).</span>}
        </div>
      )}

      <div className="full">
        <div className="card-title-row">
          <span className="field-label">Backups → BD destino</span>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><IconPlus size={15} /> Fila</button>
        </div>
        <span className="field-hint">
          «Último por patrón» toma, en cada ejecución, el backup más reciente que encaje (el * es la fecha):
          sirve para tareas recurrentes. «Archivo» restaura siempre el mismo.
        </span>
        <div className="table-scroll">
          <table className="table task-rows">
            <thead>
              <tr><th>Origen</th><th>Backup</th><th>BD destino</th>{engine && engine !== 'mysql' && <th>Opciones</th>}<th /></tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const latest = r.source === 'latest' ? pickLatest(files, r.pattern.trim()) : null;
                return (
                  <tr key={idx}>
                    <td>
                      <select value={r.source} onChange={(e) => setSource(idx, e.target.value)}>
                        <option value="latest">Último por patrón</option>
                        <option value="fixed">Archivo</option>
                      </select>
                    </td>
                    <td>
                      {r.source === 'latest' ? (
                        <div className="stack-tight">
                          <input className="mono" value={r.pattern} onChange={(e) => setRow(idx, { pattern: e.target.value })} placeholder="PaynovaBD_PRD_*.sql.gz" />
                          {files && r.pattern.trim() && (latest
                            ? <span className="field-hint">Hoy tomaría: <span className="mono">{latest.fileName}</span></span>
                            : <span className="field-hint warn-text">Ningún backup de la carpeta coincide</span>)}
                        </div>
                      ) : files?.length ? (
                        <select className="mono" value={r.backupFile} onChange={(e) => setRow(idx, { backupFile: e.target.value })}>
                          <option value="">— elegir —</option>
                          {r.backupFile && !files.some((f) => f.fileName === r.backupFile) && <option value={r.backupFile}>{r.backupFile} (no está en la carpeta)</option>}
                          {files.map((f) => <option key={f.fileName} value={f.fileName}>{f.fileName}</option>)}
                        </select>
                      ) : (
                        <input className="mono" value={r.backupFile} onChange={(e) => setRow(idx, { backupFile: e.target.value })} placeholder="archivo.bak" />
                      )}
                    </td>
                    <td><input className="mono" value={r.targetDb} onChange={(e) => setRow(idx, { targetDb: e.target.value })} placeholder="mi_bd" /></td>
                    {engine === 'postgres' && (
                      <td>
                        <div className="stack-tight">
                          <input className="mono" value={r.importUser} onChange={(e) => setRow(idx, { importUser: e.target.value })} placeholder="owner (opcional)" title="Usuario con el que se importa (PostgreSQL)" />
                          <label className="checkline small" title="Borra la BD existente por SQL con la credencial de la instancia (para BD cuyo owner no es cloudsqlsuperuser)">
                            <input type="checkbox" checked={!!r.dropViaSql} onChange={(e) => setRow(idx, { dropViaSql: e.target.checked })} /> Borrar por SQL
                          </label>
                        </div>
                      </td>
                    )}
                    {engine === 'sqlserver' && (
                      <td>
                        <div className="stack-tight">
                          <label className="checkline small" title="Tras restaurar, remapea los usuarios de BD a su login">
                            <input type="checkbox" checked={!!r.fixOrphans} onChange={(e) => setRow(idx, { fixOrphans: e.target.checked })} /> Corregir huérfanos
                          </label>
                          {r.fixOrphans && (
                            <input className="mono" value={r.dbOwner} onChange={(e) => setRow(idx, { dbOwner: e.target.value })} placeholder="login owner (opcional)" />
                          )}
                        </div>
                      </td>
                    )}
                    <td className="row-actions">
                      <button type="button" className="icon-action danger" onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                        disabled={rows.length === 1} title="Quitar fila" aria-label="Quitar fila"><IconClose size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <label className="checkline full" title="Si la app no llega por SQL a la instancia, restaura igualmente y omite esos pasos (el job queda «OK con avisos»)">
        <input type="checkbox" checked={skipSql} onChange={(e) => setSkipSql(e.target.checked)} />
        Continuar aunque falle la conexión SQL (se omiten los post-scripts y la corrección de usuarios huérfanos)
      </label>
    </FormModal>
  );
}
