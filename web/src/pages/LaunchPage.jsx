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
  const [rows, setRows] = useState([]); // [{ backupFile, targetDb }]
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
    if (instanceId) {
      api.get(`/instances/${instanceId}/buckets`).then(setBuckets).catch((e) => setError(e.message));
    }
  }, [instanceId]);

  const selectedBucket = buckets.find((b) => b.id === bucketId);
  const bucketPath = selectedBucket ? bucketPathOf(selectedBucket) : '';

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
      return [...prev, { backupFile: fileName, targetDb: fileName.replace(/\.(bak|sql|gz)$/gi, '') }];
    });

  const setTarget = (fileName, val) =>
    setRows((prev) => prev.map((r) => (r.backupFile === fileName ? { ...r, targetDb: val } : r)));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const d = await api.post('/restores', { instanceId, bucketId, bucketPath, mapping: rows });
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
        ⚠️ La restauración es destructiva: elimina la BD de destino antes de importar.
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
            <div className="muted small">Selecciona backups y define la BD destino:</div>
            <table className="table">
              <thead>
                <tr><th /><th>Archivo</th><th>Tamaño</th><th>BD destino</th></tr>
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
                          <input
                            className="mono"
                            value={r.targetDb}
                            onChange={(e) => setTarget(f.fileName, e.target.value)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <button className="btn primary" disabled={busy || rows.length === 0}>
          {busy ? 'Encolando…' : `Restaurar ${rows.length} BD`}
        </button>
      </form>
    </div>
  );
}
