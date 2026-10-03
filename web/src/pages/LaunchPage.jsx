import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

// Extensiones que lista cada motor (deben coincidir con acceptedExtensions del adaptador).
const EXTENSIONS = { sqlserver: '.bak', postgres: '.sql / .gz', mysql: '.sql / .gz' };

// gs://bucket/prefix a partir de la fila de bucket vinculado.
function bucketPathOf(b) {
  const prefix = b.base_prefix ? `/${String(b.base_prefix).replace(/^\/+|\/+$/g, '')}` : '';
  return `gs://${b.bucket_name}${prefix}`;
}

export default function LaunchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState('');
  const [buckets, setBuckets] = useState(null); // null = cargando / sin instancia
  const [bucketId, setBucketId] = useState('');
  const [files, setFiles] = useState(null); // null = aún no listados
  const [folders, setFolders] = useState([]);
  const [subPath, setSubPath] = useState([]); // subcarpetas navegadas dentro del bucket/prefijo
  const [rows, setRows] = useState([]); // [{ backupFile, targetDb, importUser }]
  // BDs y usuarios reales de la instancia (Admin API). null = no cargados / no disponibles.
  const [dbs, setDbs] = useState(null);
  const [owners, setOwners] = useState({ supported: false, users: [] });
  const [liveWarn, setLiveWarn] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    api.get('/instances').then(setInstances).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setBuckets(null);
    setBucketId('');
    setFiles(null);
    setRows([]);
    setDbs(null);
    setOwners({ supported: false, users: [] });
    setLiveWarn(null);
    if (!instanceId) return;
    api.get(`/instances/${instanceId}/buckets`)
      .then((list) => {
        setBuckets(list);
        // Preselecciona el bucket por defecto (o el único vinculado): lista sus backups solo.
        const pick = list.find((b) => b.is_default) ?? (list.length === 1 ? list[0] : null);
        if (pick) setBucketId(pick.id);
      })
      .catch((e) => { setBuckets([]); setError(e.message); });
    // Si falla (SA sin permisos, instancia inexistente...), se puede seguir escribiendo el nombre a mano.
    api.get(`/instances/${instanceId}/databases`).then(setDbs)
      .catch((e) => setLiveWarn(`No se pudieron listar las BDs de la instancia (${e.message}). Escribe el nombre de la BD destino.`));
    api.get(`/instances/${instanceId}/users`).then(setOwners)
      .catch((e) => setLiveWarn((w) => w ?? `No se pudieron listar los usuarios de la instancia (${e.message}).`));
  }, [instanceId]);

  const instance = instances.find((i) => i.id === instanceId);
  const selectedBucket = (buckets ?? []).find((b) => b.id === bucketId);
  const basePath = selectedBucket ? bucketPathOf(selectedBucket) : '';
  // Carpeta actual (base del bucket + subcarpetas): es la ruta que se lista y la que usa el job.
  const bucketPath = basePath ? [basePath, ...subPath].join('/') : '';

  const findDb = (name) => dbs?.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
  const existsDb = (name) => !!findDb(name);
  const replaced = dbs ? rows.filter((r) => r.targetDb && existsDb(r.targetDb)) : [];

  const loadFiles = async (isCurrent = () => true) => {
    setError(null);
    setLoadingFiles(true);
    setFiles(null);
    setFolders([]);
    setRows([]);
    try {
      const d = await api.get(
        `/backups?instanceId=${instanceId}&bucketPath=${encodeURIComponent(bucketPath)}`,
      );
      if (isCurrent()) { setFiles(d.files); setFolders(d.folders ?? []); }
    } catch (e) {
      if (isCurrent()) setError(e.message);
    } finally {
      if (isCurrent()) setLoadingFiles(false);
    }
  };

  // Cambiar de bucket vuelve a su carpeta base.
  useEffect(() => { setSubPath([]); }, [instanceId, bucketId]);

  // Al elegir un bucket o entrar en una carpeta, lista su contenido sin pulsar nada.
  useEffect(() => {
    setFiles(null);
    setFolders([]);
    setRows([]);
    if (!bucketPath) return;
    let current = true;
    loadFiles(() => current);
    return () => { current = false; };
  }, [instanceId, bucketPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (fileName) =>
    setRows((prev) => {
      if (prev.find((r) => r.backupFile === fileName)) {
        return prev.filter((r) => r.backupFile !== fileName);
      }
      // Sugerencia: el nombre del archivo; si coincide con una BD existente, se preselecciona esa.
      const suggested = fileName.replace(/\.(bak|sql|gz)$/gi, '');
      const match = findDb(suggested);
      return [...prev, { backupFile: fileName, targetDb: match?.name ?? suggested, isNew: !match, importUser: '' }];
    });

  const setRow = (fileName, key, val) =>
    setRows((prev) => prev.map((r) => (r.backupFile === fileName ? { ...r, [key]: val } : r)));

  // Select de BD destino: una existente (se reemplaza) o "nueva" (se escribe el nombre).
  const NEW_DB = '__new__';
  const chooseDb = (fileName, value) =>
    setRows((prev) => prev.map((r) => {
      if (r.backupFile !== fileName) return r;
      if (value === NEW_DB) return { ...r, isNew: true, targetDb: r.isNew ? r.targetDb : '' };
      return { ...r, isNew: false, targetDb: value };
    }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const mapping = rows.map((r) => ({
        backupFile: r.backupFile,
        targetDb: r.targetDb.trim(),
        ...(r.importUser ? { importUser: r.importUser } : {}),
      }));
      const d = await api.post('/restores', { instanceId, bucketId, bucketPath, mapping });
      navigate(`/jobs/${d.jobId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Lanzar restauración</h2>
      <div className="alert warn">
        ⚠️ La restauración es destructiva: si la BD de destino existe, se elimina antes de importar.
      </div>
      {error && <div className="alert error">{error}</div>}

      <form onSubmit={submit} className="stack">
        <label>
          Instancia
          <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} required>
            <option value="">— elegir —</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.project_id} / {i.instance_name} ({i.engine})
              </option>
            ))}
          </select>
        </label>
        {liveWarn && <div className="alert warn small">{liveWarn}</div>}

        <label>
          Bucket
          <select
            value={bucketId}
            onChange={(e) => setBucketId(e.target.value)}
            disabled={!buckets?.length}
            required
          >
            <option value="">
              {!instanceId ? '— elige antes la instancia —'
                : buckets === null ? 'Cargando…'
                  : buckets.length ? '— elegir —' : '(sin buckets vinculados)'}
            </option>
            {(buckets ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.bucket_name}{b.base_prefix ? `/${b.base_prefix}` : ''}{b.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>

        {instanceId && buckets?.length === 0 && (
          <div className="alert warn small">
            Esta instancia no tiene buckets vinculados.{' '}
            {user?.role === 'admin' ? (
              <>Vincúlalo en <Link to="/catalog">Catálogo</Link> → Instancias → <strong>Buckets</strong> (créalo antes en la pestaña Buckets si no existe) y márcalo como default.</>
            ) : (
              <>Pide a un administrador que vincule el bucket de backups a la instancia en el Catálogo.</>
            )}
          </div>
        )}

        {bucketPath && (
          <div className="row gap breadcrumb">
            <button type="button" className="btn ghost small mono" onClick={() => setSubPath([])} disabled={!subPath.length}>
              {basePath}
            </button>
            {subPath.map((seg, i) => (
              <span key={i} className="row gap">
                <span className="muted">/</span>
                <button type="button" className="btn ghost small mono" onClick={() => setSubPath(subPath.slice(0, i + 1))} disabled={i === subPath.length - 1}>
                  {seg}
                </button>
              </span>
            ))}
            <button type="button" className="btn ghost small" onClick={() => loadFiles()} disabled={loadingFiles}>
              {loadingFiles ? 'Listando…' : '↻ Recargar'}
            </button>
          </div>
        )}

        {(subPath.length > 0 || folders.length > 0) && (
          <div className="card">
            <div className="muted small">Carpetas</div>
            <ul className="folder-list">
              {subPath.length > 0 && (
                <li><button type="button" className="btn ghost small" onClick={() => setSubPath(subPath.slice(0, -1))}>⬆ ..</button></li>
              )}
              {folders.map((f) => (
                <li key={f}>
                  <button type="button" className="btn ghost small mono" onClick={() => setSubPath([...subPath, f])}>📁 {f}/</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {files?.length === 0 && (
          <div className="alert warn small">
            No hay backups <span className="mono">{EXTENSIONS[instance?.engine] ?? ''}</span> en{' '}
            <span className="mono">{bucketPath}/</span>.
            {folders.length > 0 ? ' Entra en una de las carpetas.' : ' Revisa el prefijo del bucket en el Catálogo.'}
          </div>
        )}

        {files?.length > 0 && (
          <div className="card">
            <div className="muted small">
              Selecciona backups y elige la BD destino: una existente de la instancia (se elimina y se reemplaza) o
              «➕ Nueva BD» para escribir el nombre.
              {owners.supported && ' El owner (PostgreSQL) es el usuario con el que se importa: los objetos quedan a su nombre.'}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th /><th>Archivo</th><th>Tamaño</th><th>BD destino</th>
                  {owners.supported && <th>Owner</th>}
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const r = rows.find((x) => x.backupFile === f.fileName);
                  return (
                    <tr key={f.fileName}>
                      <td><input type="checkbox" checked={!!r} onChange={() => toggle(f.fileName)} /></td>
                      <td className="mono small">{f.fileName}</td>
                      <td className="muted small">{(f.sizeBytes / 1e6).toFixed(1)} MB</td>
                      <td>
                        {r && (
                          <div className="row gap">
                            {dbs && (
                              <select value={r.isNew ? NEW_DB : r.targetDb} onChange={(e) => chooseDb(f.fileName, e.target.value)}>
                                <option value={NEW_DB}>➕ Nueva BD…</option>
                                {dbs.length > 0 && (
                                  <optgroup label={`BDs de la instancia (${dbs.length})`}>
                                    {dbs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                                  </optgroup>
                                )}
                              </select>
                            )}
                            {(r.isNew || !dbs) && (
                              <input
                                className="mono"
                                placeholder="nombre de la BD"
                                value={r.targetDb}
                                onChange={(e) => setRow(f.fileName, 'targetDb', e.target.value)}
                                required
                              />
                            )}
                            {dbs && r.targetDb.trim() && (existsDb(r.targetDb)
                              ? <span className="pill warn" title="La BD existe: se eliminará y se restaurará">existe · se reemplaza</span>
                              : <span className="pill on">nueva</span>)}
                          </div>
                        )}
                      </td>
                      {owners.supported && (
                        <td>
                          {r && (
                            <select value={r.importUser} onChange={(e) => setRow(f.fileName, 'importUser', e.target.value)}>
                              <option value="">(por defecto de Cloud SQL)</option>
                              {owners.users.map((u) => (
                                <option key={u.name} value={u.name}>
                                  {u.name}{u.type !== 'BUILT_IN' ? ` (${u.type})` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {replaced.length > 0 && (
          <div className="alert warn">
            Se eliminarán y reemplazarán {replaced.length} BD existente(s):{' '}
            <span className="mono">{replaced.map((r) => r.targetDb.trim()).join(', ')}</span>
          </div>
        )}

        <button className="btn primary" disabled={busy || rows.length === 0}>
          {busy ? 'Encolando…' : `Restaurar ${rows.length} BD`}
        </button>
      </form>
    </div>
  );
}
