import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { IconAlert, IconArrowUp, IconFolder, IconRefresh } from '../components/icons.jsx';

// Extensiones que lista cada motor/método (deben coincidir con acceptedExtensions del adaptador).
const EXTENSIONS = { sqlserver: '.bak', postgres: '.sql / .gz', mysql: '.sql / .gz', native: '.tar / .sql / .sql.gz' };
const isTar = (fileName) => fileName.toLowerCase().endsWith('.tar');

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
  const [rows, setRows] = useState([]); // [{ backupFile, targetDb, isNew, importUser, scope, schemaName }]
  // Método: 'import' (Cloud SQL Admin API) | 'native' (pg_restore/psql, solo PostgreSQL).
  const [method, setMethod] = useState('import');
  // Restaurar aunque falle la conexión SQL (se omiten post-scripts y corrección de huérfanos).
  const [skipSql, setSkipSql] = useState(false);
  const [dumpSchemas, setDumpSchemas] = useState({}); // archivo -> esquemas leídos del dump tar (o { error })
  // BDs y usuarios reales de la instancia (Admin API). null = no cargados / no disponibles.
  const [dbs, setDbs] = useState(null);
  const [owners, setOwners] = useState({ supported: false, users: [] });
  const [liveWarn, setLiveWarn] = useState(null);
  const [instStatus, setInstStatus] = useState(null); // { running, reason, state }
  // Logins de SQL Server (owner de la BD al corregir usuarios huérfanos).
  const [logins, setLogins] = useState({ supported: false, logins: [] });
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
    setInstStatus(null);
    setLogins({ supported: false, logins: [] });
    setMethod('import');
    setSkipSql(false);
    if (!instanceId) return;
    api.get(`/instances/${instanceId}/logins`).then(setLogins)
      .catch((e) => setLogins({ supported: true, logins: [], reason: e.message }));
    // Una instancia detenida rechaza drop/import: se avisa antes de lanzar.
    api.get(`/instances/${instanceId}/status`).then(setInstStatus).catch(() => setInstStatus(null));
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
  const native = method === 'native';
  // Corrección de usuarios huérfanos tras restaurar: solo SQL Server con conexión SQL.
  const orphansOn = logins.supported;
  const orphansReady = orphansOn && !logins.reason;
  const allOrphans = rows.length > 0 && rows.every((r) => r.fixOrphans);
  const setAllOrphans = (on) => setRows((prev) => prev.map((r) => ({ ...r, fixOrphans: on })));
  const nativeReady = Boolean(instance?.db_host && instance?.credential_ref);
  const selectedBucket = (buckets ?? []).find((b) => b.id === bucketId);
  const basePath = selectedBucket ? bucketPathOf(selectedBucket) : '';
  // Carpeta actual (base del bucket + subcarpetas): es la ruta que se lista y la que usa el job.
  const bucketPath = basePath ? [basePath, ...subPath].join('/') : '';

  const findDb = (name) => dbs?.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
  // BD existente que corresponde a un backup: nombre exacto o, si no, la de nombre más largo
  // del que el archivo es <BD>_<algo> (p.ej. QSPMS_INTERSEGURO_PRD_20261002.bak -> QSPMS_INTERSEGURO).
  const matchDbForFile = (stem) => findDb(stem) ?? (dbs ?? [])
    .filter((d) => stem.toLowerCase().startsWith(`${d.name.toLowerCase()}_`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const existsDb = (name) => !!findDb(name);
  // Solo el alcance 'BD completa' elimina la BD; por esquema solo se reemplaza ese esquema.
  const replaced = dbs ? rows.filter((r) => r.scope !== 'schema' && r.targetDb && existsDb(r.targetDb)) : [];
  const replacedSchemas = rows.filter((r) => r.scope === 'schema' && r.schemaName);

  const loadFiles = async (isCurrent = () => true) => {
    setError(null);
    setLoadingFiles(true);
    setFiles(null);
    setFolders([]);
    setRows([]);
    try {
      const d = await api.get(
        `/backups?instanceId=${instanceId}&bucketPath=${encodeURIComponent(bucketPath)}&method=${method}`,
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

  // Al elegir un bucket, entrar en una carpeta o cambiar de método, lista su contenido sin pulsar nada.
  useEffect(() => {
    setFiles(null);
    setFolders([]);
    setRows([]);
    setDumpSchemas({});
    if (!bucketPath) return;
    let current = true;
    loadFiles(() => current);
    return () => { current = false; };
  }, [instanceId, bucketPath, method]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (fileName) =>
    setRows((prev) => {
      if (prev.find((r) => r.backupFile === fileName)) {
        return prev.filter((r) => r.backupFile !== fileName);
      }
      // Sugerencia: el nombre del archivo; si coincide con una BD existente, se preselecciona esa.
      const suggested = fileName.replace(/\.(bak|sql|gz|tar)$/gi, '');
      const match = matchDbForFile(suggested);
      return [...prev, {
        backupFile: fileName, targetDb: match?.name ?? suggested, isNew: !match, importUser: '',
        scope: 'database', schemaName: '', fixOrphans: false, dbOwner: '',
      }];
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

  // Alcance por esquema: la BD destino debe existir (se elige de la lista, no se crea).
  const setScope = (fileName, scope) =>
    setRows((prev) => prev.map((r) => {
      if (r.backupFile !== fileName) return r;
      if (scope === 'schema' && r.isNew) return { ...r, scope, isNew: false, targetDb: dbs?.[0]?.name ?? '' };
      return { ...r, scope };
    }));

  // Lee los esquemas del índice de un dump tar (pg_restore --list en el servidor).
  const readSchemas = async (fileName) => {
    setDumpSchemas((m) => ({ ...m, [fileName]: { loading: true } }));
    try {
      const d = await api.get(
        `/backups/schemas?instanceId=${instanceId}&bucketPath=${encodeURIComponent(bucketPath)}&file=${encodeURIComponent(fileName)}`,
      );
      setDumpSchemas((m) => ({ ...m, [fileName]: { list: d.schemas } }));
      if (d.schemas.length === 1) setRow(fileName, 'schemaName', d.schemas[0]);
    } catch (err) {
      setDumpSchemas((m) => ({ ...m, [fileName]: { error: err.message } }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const mapping = rows.map((r) => ({
        backupFile: r.backupFile,
        targetDb: r.targetDb.trim(),
        ...(r.importUser ? { importUser: r.importUser } : {}),
        ...(native && r.scope === 'schema' ? { scope: 'schema', schemaName: r.schemaName.trim() } : {}),
        ...(orphansOn && r.fixOrphans ? { fixOrphans: true, ...(r.dbOwner ? { dbOwner: r.dbOwner } : {}) } : {}),
      }));
      const d = await api.post('/restores', {
        instanceId, bucketId, bucketPath, method, mapping, ...(!native && skipSql ? { skipSqlOnFailure: true } : {}),
      });
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
        <IconAlert /> La restauración es destructiva: si la BD de destino existe, se elimina antes de importar.
      </div>
      {error && <div className="alert error">{error}</div>}

      <form onSubmit={submit} className="stack stack-wide">
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
        {instStatus && !instStatus.running && (
          <div className="alert error">
            <IconAlert /> La instancia {instance?.instance_name} {instStatus.reason}. Iníciala en la consola de GCP
            antes de restaurar; mientras tanto no se puede lanzar el restore.
          </div>
        )}
        {liveWarn && instStatus?.running !== false && <div className="alert warn small">{liveWarn}</div>}

        {instance?.engine === 'postgres' && (
          <label>
            Método
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="import">Import de Cloud SQL (dump SQL .sql / .gz)</option>
              <option value="native">Restore nativo con pg_restore / psql (.tar, .sql, .sql.gz)</option>
            </select>
          </label>
        )}
        {native && (
          <div className={`alert small ${nativeReady ? 'warn' : 'error'}`}>
            {nativeReady ? (
              <>El restore nativo se ejecuta desde el servidor de la app contra la IP privada de la instancia
              ({instance.db_host}) con la credencial {instance.credential_name}. Permite restaurar la BD completa o
              solo un esquema (DROP SCHEMA … CASCADE y restore de ese esquema).</>
            ) : (
              <>La instancia no tiene conexión SQL (IP privada + credencial): configúrala en Catálogo → Instancias
              para usar el restore nativo.</>
            )}
          </div>
        )}

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
              <IconRefresh /> {loadingFiles ? 'Listando…' : 'Recargar'}
            </button>
          </div>
        )}

        {(subPath.length > 0 || folders.length > 0) && (
          <div className="card">
            <div className="muted small">Carpetas</div>
            <ul className="folder-list">
              {subPath.length > 0 && (
                <li><button type="button" className="btn ghost small" onClick={() => setSubPath(subPath.slice(0, -1))}><IconArrowUp /> Subir</button></li>
              )}
              {folders.map((f) => (
                <li key={f}>
                  <button type="button" className="btn ghost small mono" onClick={() => setSubPath([...subPath, f])}><IconFolder /> {f}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {files?.length === 0 && (
          <div className="alert warn small">
            No hay backups <span className="mono">{EXTENSIONS[native ? 'native' : instance?.engine] ?? ''}</span> en{' '}
            <span className="mono">{bucketPath}/</span>.
            {folders.length > 0 ? ' Entra en una de las carpetas.' : ' Revisa el prefijo del bucket en el Catálogo.'}
          </div>
        )}

        {files?.length > 0 && (
          <div className="card">
            <div className="muted small">
              Selecciona backups y elige la BD destino: una existente de la instancia (se elimina y se reemplaza) o
              «Nueva BD» para escribir el nombre.
              {native && ' Con alcance «Esquema» solo se reemplaza ese esquema dentro de una BD existente.'}
              {owners.supported && ' El owner es el rol con el que se restaura: los objetos quedan a su nombre.'}
              {orphansOn && orphansReady && ' «Corregir huérfanos»: tras restaurar la BD, remapea sus usuarios al login del mismo nombre (los que no tengan login se reportan) y, si se elige, asigna el owner de la BD.'}
            </div>
            {orphansOn && !orphansReady && (
              <div className="muted small" title={logins.reason}>
                Corrección de usuarios huérfanos no disponible (sin conexión SQL a la instancia). El restore no la
                necesita: se hace por el API de GCP.
                {user?.role === 'admin' && <> Para usarla, revisa la IP privada y la credencial en <Link to="/catalog">Catálogo</Link> → Instancias.</>}
              </div>
            )}
            {orphansOn && orphansReady && rows.length > 1 && (
              <div className="row gap">
                <button type="button" className="btn ghost small" onClick={() => setAllOrphans(!allOrphans)}>
                  {allOrphans ? 'Desmarcar «Corregir huérfanos» en todas' : 'Marcar «Corregir huérfanos» en todas'}
                </button>
              </div>
            )}
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th /><th>Archivo</th><th>Tamaño</th>
                  {native && <th>Alcance</th>}
                  <th>BD destino</th>
                  {owners.supported && <th>Owner</th>}
                  {orphansOn && <th>Usuarios huérfanos</th>}
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
                      {native && (
                        <td>
                          {r && (
                            <div className="stack-tight">
                              <select value={r.scope} onChange={(e) => setScope(f.fileName, e.target.value)}>
                                <option value="database">BD completa</option>
                                <option value="schema" disabled={!dbs?.length}>Solo un esquema</option>
                              </select>
                              {r.scope === 'schema' && (
                                <SchemaPicker
                                  fileName={f.fileName}
                                  value={r.schemaName}
                                  onChange={(v) => setRow(f.fileName, 'schemaName', v)}
                                  state={dumpSchemas[f.fileName]}
                                  onRead={() => readSchemas(f.fileName)}
                                />
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      <td>
                        {r && (
                          <div className="row gap">
                            {dbs && (
                              <select value={r.isNew ? NEW_DB : r.targetDb} onChange={(e) => chooseDb(f.fileName, e.target.value)}>
                                {r.scope !== 'schema' && <option value={NEW_DB}>Nueva BD…</option>}
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
                            {dbs && r.targetDb.trim() && r.scope !== 'schema' && (existsDb(r.targetDb)
                              ? <span className="pill warn" title="La BD existe: se eliminará y se restaurará">existe · se reemplaza</span>
                              : <span className="pill on">nueva</span>)}
                            {r.scope === 'schema' && r.schemaName && (
                              <span className="pill warn" title="Se elimina el esquema (CASCADE) y se restaura">esquema se reemplaza</span>
                            )}
                          </div>
                        )}
                      </td>
                      {owners.supported && (
                        <td>
                          {r && (
                            <select value={r.importUser} onChange={(e) => setRow(f.fileName, 'importUser', e.target.value)}>
                              <option value="">{native ? '(usuario de la credencial)' : '(por defecto de Cloud SQL)'}</option>
                              {owners.users.map((u) => (
                                <option key={u.name} value={u.name}>
                                  {u.name}{u.type !== 'BUILT_IN' ? ` (${u.type})` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      )}
                      {orphansOn && (
                        <td>
                          {r && (
                            <div className="stack-tight">
                              <label className="checkline small" title={orphansReady ? undefined : logins.reason}>
                                <input type="checkbox" checked={r.fixOrphans} disabled={!orphansReady}
                                  onChange={(e) => setRow(f.fileName, 'fixOrphans', e.target.checked)} />
                                Corregir huérfanos
                              </label>
                              {!orphansReady && <span className="muted small">Requiere conexión SQL</span>}
                              {r.fixOrphans && (
                                <select value={r.dbOwner} onChange={(e) => setRow(f.fileName, 'dbOwner', e.target.value)}
                                  title="Login a asignar como owner si el owner de la BD quedó huérfano">
                                  <option value="">Owner: no tocar</option>
                                  {logins.logins.map((l) => <option key={l.name} value={l.name}>Owner: {l.name}</option>)}
                                </select>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {replaced.length > 0 && (
          <div className="alert warn">
            Se eliminarán y reemplazarán {replaced.length} BD existente(s):{' '}
            <span className="mono">{replaced.map((r) => r.targetDb.trim()).join(', ')}</span>
          </div>
        )}
        {replacedSchemas.length > 0 && (
          <div className="alert warn">
            Se eliminarán (CASCADE) y restaurarán {replacedSchemas.length} esquema(s):{' '}
            <span className="mono">{replacedSchemas.map((r) => `${r.targetDb.trim()}.${r.schemaName.trim()}`).join(', ')}</span>
          </div>
        )}

        {!native && rows.length > 0 && (
          <label className="checkline small" title="Si la app no llega por SQL a la instancia, restaura igualmente y omite esos pasos (el job queda «OK con avisos»)">
            <input type="checkbox" checked={skipSql} onChange={(e) => setSkipSql(e.target.checked)} />
            Continuar aunque falle la conexión SQL (se omiten los post-scripts y la corrección de usuarios huérfanos; los pre-scripts la exigen siempre)
          </label>
        )}

        <button className="btn primary" disabled={busy || rows.length === 0 || (native && !nativeReady) || instStatus?.running === false}>
          {busy ? 'Encolando…' : `Restaurar ${rows.length} ${rows.length === 1 ? 'destino' : 'destinos'}`}
        </button>
      </form>
    </div>
  );
}

// Esquema a restaurar: de la lista leída del dump tar (pg_restore --list) o escrito a
// mano (dumps planos, que no tienen índice: deben ser de ese esquema, pg_dump -n).
function SchemaPicker({ fileName, value, onChange, state, onRead }) {
  if (state?.list?.length) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">— esquema —</option>
        {state.list.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
      </select>
    );
  }
  return (
    <div className="stack-tight">
      <input className="mono" placeholder="nombre del esquema" value={value} onChange={(e) => onChange(e.target.value)} required />
      {isTar(fileName) && (
        <button type="button" className="btn ghost small" onClick={onRead} disabled={state?.loading}>
          {state?.loading ? 'Leyendo el dump…' : 'Leer esquemas del dump'}
        </button>
      )}
      {state?.error && <span className="small" style={{ color: 'var(--err)' }}>{state.error}</span>}
    </div>
  );
}
