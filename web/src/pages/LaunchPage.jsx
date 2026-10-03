import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

// gs://bucket/prefix a partir de la fila de bucket vinculado.
function bucketPathOf(b) {
  const prefix = b.base_prefix ? `/${String(b.base_prefix).replace(/^\/+|\/+$/g, '')}` : '';
  return `gs://${b.bucket_name}${prefix}`;
}

export default function LaunchPage() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState('');
  const [buckets, setBuckets] = useState([]);
  const [bucketId, setBucketId] = useState('');
  const [files, setFiles] = useState([]);
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
    setBuckets([]);
    setBucketId('');
    setFiles([]);
    setRows([]);
    setDbs(null);
    setOwners({ supported: false, users: [] });
    setLiveWarn(null);
    if (!instanceId) return;
    api.get(`/instances/${instanceId}/buckets`).then(setBuckets).catch((e) => setError(e.message));
    // Si falla (SA sin permisos, instancia inexistente...), se puede seguir escribiendo el nombre a mano.
    api.get(`/instances/${instanceId}/databases`).then(setDbs)
      .catch((e) => setLiveWarn(`No se pudieron listar las BDs de la instancia (${e.message}). Escribe el nombre de la BD destino.`));
    api.get(`/instances/${instanceId}/users`).then(setOwners)
      .catch((e) => setLiveWarn((w) => w ?? `No se pudieron listar los usuarios de la instancia (${e.message}).`));
  }, [instanceId]);

  const selectedBucket = buckets.find((b) => b.id === bucketId);
  const bucketPath = selectedBucket ? bucketPathOf(selectedBucket) : '';

  const existsDb = (name) => !!dbs?.some((d) => d.name.toLowerCase() === name.trim().toLowerCase());
  const replaced = dbs ? rows.filter((r) => r.targetDb && existsDb(r.targetDb)) : [];

  const loadFiles = async () => {
    setError(null);
    setLoadingFiles(true);
    setFiles([]);
    setRows([]);
    try {
      const d = await api.get(
        `/backups?instanceId=${instanceId}&bucketPath=${encodeURIComponent(bucketPath)}`,
      );
      setFiles(d.files);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingFiles(false);
    }
  };

  const toggle = (fileName) =>
    setRows((prev) => {
      if (prev.find((r) => r.backupFile === fileName)) {
        return prev.filter((r) => r.backupFile !== fileName);
      }
      return [...prev, { backupFile: fileName, targetDb: fileName.replace(/\.(bak|sql|gz)$/gi, ''), importUser: '' }];
    });

  const setRow = (fileName, key, val) =>
    setRows((prev) => prev.map((r) => (r.backupFile === fileName ? { ...r, [key]: val } : r)));

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
            disabled={!buckets.length}
            required
          >
            <option value="">{buckets.length ? '— elegir —' : '(sin buckets vinculados)'}</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bucket_name}{b.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>

        {bucketPath && <div className="muted small mono">{bucketPath}</div>}

        <div>
          <button type="button" className="btn" onClick={loadFiles} disabled={!bucketPath || loadingFiles}>
            {loadingFiles ? 'Listando…' : 'Listar backups'}
          </button>
        </div>

        {files.length > 0 && (
          <div className="card">
            <div className="muted small">
              Selecciona backups y define la BD destino: elige una existente (se reemplaza) o escribe un nombre nuevo.
              {owners.supported && ' El owner (PostgreSQL) es el usuario con el que se importa: los objetos quedan a su nombre.'}
            </div>
            <datalist id="instance-dbs">
              {(dbs ?? []).map((d) => <option key={d.name} value={d.name} />)}
            </datalist>
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
                            <input
                              className="mono"
                              list="instance-dbs"
                              value={r.targetDb}
                              onChange={(e) => setRow(f.fileName, 'targetDb', e.target.value)}
                              required
                            />
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
