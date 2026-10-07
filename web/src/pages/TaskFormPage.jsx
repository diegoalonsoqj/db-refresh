import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { IconAlert, IconArrowUp, IconClose, IconFolder, IconPlus, IconRefresh } from '../components/icons.jsx';
import { useToast } from '../components/Toast.jsx';
import { stripBackupExt, suggestDbName } from '../lib/backupName.js';
import { pickLatest, suggestPattern } from '../lib/schedule.js';

// Extensiones que lista cada motor/método (deben coincidir con acceptedExtensions del adaptador).
const EXTENSIONS = { sqlserver: '.bak', postgres: '.sql / .gz', mysql: '.sql / .gz', native: '.tar / .sql / .sql.gz' };
const isTar = (fileName) => String(fileName ?? '').toLowerCase().endsWith('.tar');
const NEW_DB = '__new__';

// gs://bucket/prefix a partir de la fila de bucket vinculado.
function bucketPathOf(b) {
  const prefix = b.base_prefix ? `/${String(b.base_prefix).replace(/^\/+|\/+$/g, '')}` : '';
  return `gs://${b.bucket_name}${prefix}`;
}

let rowSeq = 0;
const newRow = (patch = {}) => ({
  key: ++rowSeq, source: 'latest', pattern: '', backupFile: '', targetDb: '', isNew: true, importUser: '',
  scope: 'database', schemaName: '', fixOrphans: false, dbOwner: '', dropViaSql: false, ...patch,
});

/**
 * Formulario de una tarea de restore (modelo de db-keeper): se define QUÉ
 * restaurar y se guarda; la tarea se ejecuta o se programa desde la lista de
 * tareas. Cada fila toma el último backup que encaje con un patrón (lo normal en
 * tareas recurrentes) o un archivo concreto de la carpeta.
 */
export default function TaskFormPage() {
  const { id } = useParams(); // edición si viene id
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  // Tarea a cargar en edición: se aplica a medida que llegan instancia, buckets y carpeta.
  const init = useRef(null);
  const [loadingTask, setLoadingTask] = useState(Boolean(id));
  const [name, setName] = useState('');
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState('');
  const [buckets, setBuckets] = useState(null); // null = cargando / sin instancia
  const [bucketId, setBucketId] = useState('');
  const [files, setFiles] = useState(null); // null = aún no listados
  const [folders, setFolders] = useState([]);
  const [subPath, setSubPath] = useState([]); // subcarpetas navegadas dentro del bucket/prefijo
  const [rows, setRows] = useState([]);
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

  // Edición: carga la tarea.
  useEffect(() => {
    if (!id) return;
    api.get(`/schedules/${id}`)
      .then((t) => { init.current = t; setName(t.name); setInstanceId(t.instance_ref); })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingTask(false));
  }, [id]);

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
    const t = init.current?.instance_ref === instanceId ? init.current : null;
    if (t) {
      setMethod(t.method ?? 'import');
      setSkipSql(Boolean(t.skip_sql_on_failure));
      setRows(t.mapping.map((m) => newRow({
        source: m.source ?? 'fixed', pattern: m.pattern ?? '', backupFile: m.backupFile ?? '',
        targetDb: m.targetDb ?? '', isNew: false, importUser: m.importUser ?? '', scope: m.scope ?? 'database',
        schemaName: m.schemaName ?? '', fixOrphans: Boolean(m.fixOrphans), dbOwner: m.dbOwner ?? '', dropViaSql: Boolean(m.dropViaSql),
      })));
    }
    api.get(`/instances/${instanceId}/logins`).then(setLogins)
      .catch((e) => setLogins({ supported: true, logins: [], reason: e.message }));
    // Una instancia detenida rechaza drop/import: se avisa (la tarea fallará si sigue así al ejecutarse).
    api.get(`/instances/${instanceId}/status`).then(setInstStatus).catch(() => setInstStatus(null));
    api.get(`/instances/${instanceId}/buckets`)
      .then((list) => {
        // En edición, el bucket de la tarea aunque ya no esté vinculado.
        if (t && !list.some((b) => b.id === t.bucket_ref)) {
          list = [...list, { id: t.bucket_ref, bucket_name: t.bucket_name, base_prefix: t.base_prefix }];
        }
        setBuckets(list);
        const pick = t ? list.find((b) => b.id === t.bucket_ref)
          : list.find((b) => b.is_default) ?? (list.length === 1 ? list[0] : null);
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
  // Borrar la BD por SQL (credencial) en vez del Admin API: solo PostgreSQL, BD completa y existente.
  // Hace falta si su owner no es cloudsqlsuperuser (p.ej. BD creadas por otra herramienta).
  const isPg = instance?.engine === 'postgres';
  const selectedBucket = (buckets ?? []).find((b) => b.id === bucketId);
  const basePath = selectedBucket ? bucketPathOf(selectedBucket) : '';
  // Carpeta actual (base del bucket + subcarpetas): es la carpeta de la tarea.
  const bucketPath = basePath ? [basePath, ...subPath].join('/') : '';

  const findDb = (n) => dbs?.find((d) => d.name.toLowerCase() === String(n).trim().toLowerCase());
  // BD existente que corresponde a un backup: nombre exacto o, si no, la de nombre más largo
  // del que el archivo es <BD>_<algo> (p.ej. QSPMS_INTERSEGURO_PRD_20261002.bak -> QSPMS_INTERSEGURO).
  const matchDbForFile = (stem) => findDb(stem) ?? (dbs ?? [])
    .filter((d) => stem.toLowerCase().startsWith(`${d.name.toLowerCase()}_`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const existsDb = (n) => !!findDb(n);
  // Sin la lista de BDs (falló databases.list) no se sabe si existe: se ofrece igual.
  const canDropViaSql = (r) => isPg && r.scope !== 'schema' && !!r.targetDb.trim() && (!dbs || existsDb(r.targetDb));
  // Solo el alcance 'BD completa' elimina la BD; por esquema solo se reemplaza ese esquema.
  const replaced = dbs ? rows.filter((r) => r.scope !== 'schema' && r.targetDb && existsDb(r.targetDb)) : [];
  const replacedSchemas = rows.filter((r) => r.scope === 'schema' && r.schemaName);
  // Archivo al que apunta hoy una fila (el fijo o el último que encaja con el patrón).
  const currentFile = (r) => (r.source === 'fixed' ? r.backupFile : pickLatest(files, r.pattern.trim())?.fileName ?? '');

  // Con la lista de BDs ya cargada, las filas cuya BD no existe pasan a «Nueva BD».
  useEffect(() => {
    if (!dbs) return;
    setRows((prev) => prev.map((r) => (!r.isNew && r.targetDb && !findDb(r.targetDb) ? { ...r, isNew: true } : r)));
  }, [dbs]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFiles = async (isCurrent = () => true) => {
    setError(null);
    setLoadingFiles(true);
    setFiles(null);
    setFolders([]);
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

  // Cambiar de bucket vuelve a su carpeta base (en edición, a la carpeta de la tarea).
  useEffect(() => {
    const t = init.current;
    if (t && t.instance_ref === instanceId && t.bucket_ref === bucketId && basePath) {
      const saved = t.bucket_path && t.bucket_path.startsWith(`${basePath}/`) ? t.bucket_path.slice(basePath.length + 1) : '';
      setSubPath(saved ? saved.split('/') : []);
      init.current = null; // edición aplicada
      return;
    }
    setSubPath([]);
  }, [instanceId, bucketId, basePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al elegir un bucket, entrar en una carpeta o cambiar de método, lista su contenido sin pulsar nada.
  // Las filas de la tarea se conservan: los patrones se aplican a la carpeta que se elija.
  useEffect(() => {
    setFiles(null);
    setFolders([]);
    setDumpSchemas({});
    if (!bucketPath) return;
    let current = true;
    loadFiles(() => current);
    return () => { current = false; };
  }, [instanceId, bucketPath, method]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcar un backup añade una fila (por defecto «último por patrón»); desmarcarlo quita las que apuntan a él.
  const toggleFile = (fileName) =>
    setRows((prev) => {
      if (prev.some((r) => currentFile(r) === fileName)) return prev.filter((r) => currentFile(r) !== fileName);
      // Si el archivo corresponde a una BD existente, se preselecciona esa; si no, se sugiere
      // el nombre de la BD sacado del archivo (PaynovaBD_PRD_20261002_201635.sql.gz -> PaynovaBD).
      const suggested = suggestDbName(fileName);
      const match = matchDbForFile(stripBackupExt(fileName)) ?? findDb(suggested);
      return [...prev, newRow({
        source: 'latest', pattern: suggestPattern(fileName), backupFile: fileName,
        targetDb: match?.name ?? suggested, isNew: !match,
      })];
    });

  const setRow = (key, patch) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Origen de una fila: al pasar a patrón se sugiere desde el archivo; al pasar a archivo, el de hoy.
  const setSource = (key, source) => setRows((prev) => prev.map((r) => {
    if (r.key !== key) return r;
    if (source === 'latest') return { ...r, source, pattern: r.pattern || suggestPattern(r.backupFile) };
    return { ...r, source, backupFile: r.backupFile || pickLatest(files, r.pattern.trim())?.fileName || '' };
  }));

  // Select de BD destino: una existente (se reemplaza) o "nueva" (se escribe el nombre).
  const chooseDb = (key, value) => setRows((prev) => prev.map((r) => {
    if (r.key !== key) return r;
    if (value === NEW_DB) return { ...r, isNew: true, targetDb: r.isNew ? r.targetDb : '' };
    return { ...r, isNew: false, targetDb: value };
  }));

  // Alcance por esquema: la BD destino debe existir (se elige de la lista, no se crea).
  const setScope = (key, scope) => setRows((prev) => prev.map((r) => {
    if (r.key !== key) return r;
    if (scope === 'schema' && r.isNew) return { ...r, scope, isNew: false, targetDb: dbs?.[0]?.name ?? '' };
    return { ...r, scope };
  }));

  // Cambiar a import quita el alcance por esquema (solo existe en el nativo).
  const changeMethod = (m) => {
    setMethod(m);
    if (m !== 'native') setRows((prev) => prev.map((r) => ({ ...r, scope: 'database', schemaName: '' })));
  };

  // Lee los esquemas del índice de un dump tar (pg_restore --list en el servidor).
  const readSchemas = async (key, fileName) => {
    setDumpSchemas((m) => ({ ...m, [fileName]: { loading: true } }));
    try {
      const d = await api.get(
        `/backups/schemas?instanceId=${instanceId}&bucketPath=${encodeURIComponent(bucketPath)}&file=${encodeURIComponent(fileName)}`,
      );
      setDumpSchemas((m) => ({ ...m, [fileName]: { list: d.schemas } }));
      if (d.schemas.length === 1) setRow(key, { schemaName: d.schemas[0] });
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
        source: r.source,
        ...(r.source === 'latest' ? { pattern: r.pattern.trim() } : { backupFile: r.backupFile }),
        targetDb: r.targetDb.trim(),
        ...(r.importUser ? { importUser: r.importUser } : {}),
        ...(native && r.scope === 'schema' ? { scope: 'schema', schemaName: r.schemaName.trim() } : {}),
        ...(orphansOn && r.fixOrphans ? { fixOrphans: true, ...(r.dbOwner ? { dbOwner: r.dbOwner } : {}) } : {}),
        ...(r.dropViaSql && canDropViaSql(r) ? { dropViaSql: true } : {}),
      }));
      const body = {
        name, instanceRef: instanceId, bucketRef: bucketId, bucketPath, method, mapping,
        skipSqlOnFailure: !native && skipSql,
      };
      const saved = id ? await api.put(`/schedules/${id}`, body) : await api.post('/schedules', body);
      toast.success(id ? `Tarea «${saved.name}» guardada` : `Tarea «${saved.name}» creada: ejecútala o prográmala desde la lista`);
      navigate('/tasks');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loadingTask) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="alert warn">
        <IconAlert /> La restauración es destructiva: al ejecutar la tarea, si la BD de destino existe, se elimina antes de importar.
      </div>
      {error && <div className="alert error">{error}</div>}

      <form onSubmit={submit} className="launch">
        {/* 1. Tarea y origen: nombre, instancia, método y bucket */}
        <section className="card launch-section">
          <h3 className="card-title">{id ? 'Editar tarea' : 'Nueva tarea'}</h3>
          <div className="form-grid">
            <label className="full">
              Nombre de la tarea
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ej. PaynovaBD homologación (diario)" required />
            </label>
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

            {instance?.engine === 'postgres' && (
              <label>
                Método
                <select value={method} onChange={(e) => changeMethod(e.target.value)}>
                  <option value="import">Import de Cloud SQL (dump SQL .sql / .gz)</option>
                  <option value="native">Restore nativo con pg_restore / psql (.tar, .sql, .sql.gz)</option>
                </select>
              </label>
            )}

            <label>
              Bucket
              <select value={bucketId} onChange={(e) => setBucketId(e.target.value)} disabled={!buckets?.length} required>
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

            {instStatus && !instStatus.running && (
              <div className="alert warn full">
                <IconAlert /> La instancia {instance?.instance_name} {instStatus.reason}. Puedes guardar la tarea, pero
                no se podrá ejecutar hasta que la inicies en la consola de GCP.
              </div>
            )}
            {liveWarn && instStatus?.running !== false && <div className="alert warn small full">{liveWarn}</div>}

            {native && (
              <div className={`alert small full ${nativeReady ? 'warn' : 'error'}`}>
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

            {instanceId && buckets?.length === 0 && (
              <div className="alert warn small full">
                Esta instancia no tiene buckets vinculados.{' '}
                {user?.role === 'admin' ? (
                  <>Vincúlalo en <Link to="/catalog">Catálogo</Link> → Instancias → Editar → pestaña <strong>Buckets</strong> (créalo antes en Catálogo → Buckets si no existe) y márcalo como default.</>
                ) : (
                  <>Pide a un administrador que vincule el bucket de backups a la instancia en el Catálogo.</>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 2. Carpeta de backups: navegación y selección de archivos */}
        {bucketPath && (
          <section className="card launch-section">
            <div className="card-title-row">
              <h3 className="card-title">Carpeta de backups</h3>
              <button type="button" className="btn small" onClick={() => loadFiles()} disabled={loadingFiles}>
                <IconRefresh size={15} /> {loadingFiles ? 'Listando…' : 'Recargar'}
              </button>
            </div>

            <div className="breadcrumb">
              <button type="button" className="crumb mono" onClick={() => setSubPath([])} disabled={!subPath.length}>
                {basePath}
              </button>
              {subPath.map((seg, i) => (
                <span key={i} className="crumb-item">
                  <span className="muted">/</span>
                  <button type="button" className="crumb mono" onClick={() => setSubPath(subPath.slice(0, i + 1))} disabled={i === subPath.length - 1}>
                    {seg}
                  </button>
                </span>
              ))}
            </div>

            {(subPath.length > 0 || folders.length > 0) && (
              <ul className="folder-list">
                {subPath.length > 0 && (
                  <li><button type="button" className="btn small" onClick={() => setSubPath(subPath.slice(0, -1))}><IconArrowUp size={15} /> Subir</button></li>
                )}
                {folders.map((f) => (
                  <li key={f}>
                    <button type="button" className="btn small mono" onClick={() => setSubPath([...subPath, f])}><IconFolder size={15} /> {f}</button>
                  </li>
                ))}
              </ul>
            )}

            {files === null && loadingFiles && <div className="muted small">Listando backups…</div>}

            {files?.length === 0 && (
              <div className="alert warn small">
                No hay backups <span className="mono">{EXTENSIONS[native ? 'native' : instance?.engine] ?? ''}</span> en{' '}
                <span className="mono">{bucketPath}/</span>.
                {folders.length > 0 ? ' Entra en una de las carpetas.' : ' Revisa el prefijo del bucket en el Catálogo.'}
              </div>
            )}

            {files?.length > 0 && (
              <>
                <div className="muted small">
                  Marca los backups que restaura la tarea: cada uno añade una fila abajo. La tarea usa los backups de esta carpeta.
                </div>
                <div className="table-scroll launch-files">
                  <table className="table">
                    <thead><tr><th /><th>Archivo</th><th>Tamaño</th><th>Actualizado</th></tr></thead>
                    <tbody>
                      {files.map((f) => {
                        const used = rows.some((r) => currentFile(r) === f.fileName);
                        return (
                          <tr key={f.fileName} className={used ? 'selected' : ''}>
                            <td><input type="checkbox" checked={used} onChange={() => toggleFile(f.fileName)} /></td>
                            <td className="mono small">{f.fileName}</td>
                            <td className="muted small">{(f.sizeBytes / 1e6).toFixed(1)} MB</td>
                            <td className="muted small">{f.updated ? new Date(f.updated).toLocaleString() : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* 3. Restauraciones de la tarea: backup (patrón o archivo) -> BD destino */}
        {instanceId && (
          <section className="card launch-section">
            <div className="card-title-row">
              <h3 className="card-title">Restauraciones de la tarea</h3>
              <button type="button" className="btn small" onClick={() => setRows((prev) => [...prev, newRow()])}>
                <IconPlus size={15} /> Fila
              </button>
            </div>
            <div className="muted small">
              «Último por patrón» toma en cada ejecución el backup más reciente de la carpeta que encaje (el * es la
              fecha): es lo que sirve en tareas recurrentes. «Archivo» restaura siempre el mismo.
              {native && ' Con alcance «Esquema» solo se reemplaza ese esquema dentro de una BD existente.'}
              {owners.supported && ' El owner es el rol con el que se restaura: los objetos y la BD quedan a su nombre (se asigna por SQL; requiere la conexión SQL de la instancia). Para volver a reemplazar una BD con owner propio, marca «Borrar por SQL».'}
              {isPg && ' «Borrar por SQL»: borra la BD existente con la credencial de la instancia en vez del API de GCP; márcalo si su owner no es cloudsqlsuperuser (el API no puede borrarla).'}
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
                <button type="button" className="btn small" onClick={() => setAllOrphans(!allOrphans)}>
                  {allOrphans ? 'Desmarcar «Corregir huérfanos» en todas' : 'Marcar «Corregir huérfanos» en todas'}
                </button>
              </div>
            )}

            {rows.length === 0 ? (
              <div className="muted small">Marca un backup de la carpeta o añade una fila.</div>
            ) : (
              <div className="table-scroll launch-files">
                <table className="table task-rows">
                  <thead>
                    <tr>
                      <th>Origen</th><th>Backup</th>
                      {native && <th>Alcance</th>}
                      <th>BD destino</th>
                      {owners.supported && <th>Owner</th>}
                      {orphansOn && <th>Usuarios huérfanos</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const today = currentFile(r);
                      return (
                        <tr key={r.key}>
                          <td>
                            <select value={r.source} onChange={(e) => setSource(r.key, e.target.value)}>
                              <option value="latest">Último por patrón</option>
                              <option value="fixed">Archivo</option>
                            </select>
                          </td>
                          <td>
                            {r.source === 'latest' ? (
                              <div className="stack-tight">
                                <input className="mono" value={r.pattern} onChange={(e) => setRow(r.key, { pattern: e.target.value })}
                                  placeholder="PaynovaBD_PRD_*.sql.gz" required />
                                {files && r.pattern.trim() && (today
                                  ? <span className="field-hint">Hoy tomaría: <span className="mono">{today}</span></span>
                                  : <span className="field-hint warn-text">Ningún backup de la carpeta coincide</span>)}
                              </div>
                            ) : files?.length ? (
                              <select className="mono" value={r.backupFile} onChange={(e) => setRow(r.key, { backupFile: e.target.value })} required>
                                <option value="">— elegir —</option>
                                {r.backupFile && !files.some((f) => f.fileName === r.backupFile) && (
                                  <option value={r.backupFile}>{r.backupFile} (no está en la carpeta)</option>
                                )}
                                {files.map((f) => <option key={f.fileName} value={f.fileName}>{f.fileName}</option>)}
                              </select>
                            ) : (
                              <input className="mono" value={r.backupFile} onChange={(e) => setRow(r.key, { backupFile: e.target.value })} placeholder="archivo.bak" required />
                            )}
                          </td>
                          {native && (
                            <td>
                              <div className="stack-tight">
                                <select value={r.scope} onChange={(e) => setScope(r.key, e.target.value)}>
                                  <option value="database">BD completa</option>
                                  <option value="schema" disabled={!dbs?.length}>Solo un esquema</option>
                                </select>
                                {r.scope === 'schema' && (
                                  <SchemaPicker
                                    fileName={today}
                                    value={r.schemaName}
                                    onChange={(v) => setRow(r.key, { schemaName: v })}
                                    state={dumpSchemas[today]}
                                    onRead={() => readSchemas(r.key, today)}
                                  />
                                )}
                              </div>
                            </td>
                          )}
                          <td>
                            <div className="row gap">
                              {dbs && (
                                <select value={r.isNew ? NEW_DB : r.targetDb} onChange={(e) => chooseDb(r.key, e.target.value)}>
                                  {r.scope !== 'schema' && <option value={NEW_DB}>Nueva BD…</option>}
                                  {dbs.length > 0 && (
                                    <optgroup label={`BDs de la instancia (${dbs.length})`}>
                                      {dbs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                                    </optgroup>
                                  )}
                                </select>
                              )}
                              {(r.isNew || !dbs) && (
                                <input className="mono" placeholder="nombre de la BD" value={r.targetDb}
                                  onChange={(e) => setRow(r.key, { targetDb: e.target.value })} required />
                              )}
                              {dbs && r.targetDb.trim() && r.scope !== 'schema' && (existsDb(r.targetDb)
                                ? <span className="pill warn" title="La BD existe: se eliminará y se restaurará">existe · se reemplaza</span>
                                : <span className="pill on">nueva</span>)}
                              {r.scope === 'schema' && r.schemaName && (
                                <span className="pill warn" title="Se elimina el esquema (CASCADE) y se restaura">esquema se reemplaza</span>
                              )}
                              {canDropViaSql(r) && (
                                <label className="checkline small"
                                  title={nativeReady
                                    ? 'DROP DATABASE por SQL con la credencial de la instancia (para BD cuyo owner no es cloudsqlsuperuser)'
                                    : 'Requiere la conexión SQL de la instancia (IP privada + credencial)'}>
                                  <input type="checkbox" checked={!!r.dropViaSql} disabled={!nativeReady}
                                    onChange={(e) => setRow(r.key, { dropViaSql: e.target.checked })} />
                                  Borrar por SQL
                                </label>
                              )}
                            </div>
                          </td>
                          {owners.supported && (
                            <td>
                              <select value={r.importUser} onChange={(e) => setRow(r.key, { importUser: e.target.value })}
                                disabled={!nativeReady && !r.importUser}
                                title={nativeReady ? undefined : 'Asignar owner requiere la conexión SQL de la instancia (IP privada + credencial)'}>
                                <option value="">{native ? '(usuario de la credencial)' : '(por defecto de Cloud SQL)'}</option>
                                {r.importUser && !owners.users.some((u) => u.name === r.importUser) && <option value={r.importUser}>{r.importUser}</option>}
                                {owners.users.map((u) => (
                                  <option key={u.name} value={u.name}>
                                    {u.name}{u.type !== 'BUILT_IN' ? ` (${u.type})` : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          {orphansOn && (
                            <td>
                              <div className="stack-tight">
                                <label className="checkline small" title={orphansReady ? undefined : logins.reason}>
                                  <input type="checkbox" checked={r.fixOrphans} disabled={!orphansReady}
                                    onChange={(e) => setRow(r.key, { fixOrphans: e.target.checked })} />
                                  Corregir huérfanos
                                </label>
                                {!orphansReady && <span className="muted small">Requiere conexión SQL</span>}
                                {r.fixOrphans && (
                                  <select value={r.dbOwner} onChange={(e) => setRow(r.key, { dbOwner: e.target.value })}
                                    title="Login a asignar como owner si el owner de la BD quedó huérfano">
                                    <option value="">Owner: no tocar</option>
                                    {r.dbOwner && !logins.logins.some((l) => l.name === r.dbOwner) && <option value={r.dbOwner}>Owner: {r.dbOwner}</option>}
                                    {logins.logins.map((l) => <option key={l.name} value={l.name}>Owner: {l.name}</option>)}
                                  </select>
                                )}
                              </div>
                            </td>
                          )}
                          <td className="row-actions">
                            <button type="button" className="icon-action danger" title="Quitar fila" aria-label="Quitar fila"
                              onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}><IconClose size={16} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* 4. Resumen, opciones y guardar */}
        <section className="card launch-section">
          <h3 className="card-title">Guardar</h3>
          {replaced.length > 0 && (
            <div className="alert warn">
              Al ejecutarse, la tarea eliminará y reemplazará {replaced.length} BD existente(s):{' '}
              <span className="mono">{replaced.map((r) => `${r.targetDb.trim()}${r.dropViaSql ? ' (por SQL)' : ''}`).join(', ')}</span>
            </div>
          )}
          {replacedSchemas.length > 0 && (
            <div className="alert warn">
              Al ejecutarse, la tarea eliminará (CASCADE) y restaurará {replacedSchemas.length} esquema(s):{' '}
              <span className="mono">{replacedSchemas.map((r) => `${r.targetDb.trim()}.${r.schemaName.trim()}`).join(', ')}</span>
            </div>
          )}

          {!native && rows.length > 0 && (
            <label className="checkline small" title="Si la app no llega por SQL a la instancia, restaura igualmente y omite esos pasos (el job queda «OK con avisos»)">
              <input type="checkbox" checked={skipSql} onChange={(e) => setSkipSql(e.target.checked)} />
              Continuar aunque falle la conexión SQL (se omiten los post-scripts y la corrección de usuarios huérfanos; los pre-scripts la exigen siempre)
            </label>
          )}

          <div className="muted small">
            Guardar no ejecuta nada: la tarea se ejecuta o se programa (una vez o recurrente) desde la lista de tareas.
          </div>
          <div className="launch-actions">
            <Link className="btn" to="/tasks">Cancelar</Link>
            <button className="btn primary" disabled={busy || rows.length === 0 || (native && !nativeReady)}>
              {busy ? 'Guardando…' : id ? 'Guardar cambios' : 'Guardar tarea'}
            </button>
          </div>
        </section>
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
        {value && !state.list.includes(value) && <option value={value}>{value}</option>}
        {state.list.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
      </select>
    );
  }
  return (
    <div className="stack-tight">
      <input className="mono" placeholder="nombre del esquema" value={value} onChange={(e) => onChange(e.target.value)} required />
      {isTar(fileName) && (
        <button type="button" className="btn small" onClick={onRead} disabled={state?.loading}>
          {state?.loading ? 'Leyendo el dump…' : 'Leer esquemas del dump'}
        </button>
      )}
      {state?.error && <span className="small" style={{ color: 'var(--err)' }}>{state.error}</span>}
    </div>
  );
}
