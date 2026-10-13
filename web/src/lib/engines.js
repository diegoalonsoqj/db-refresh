// Motores de BD que restaura la app: etiquetas, puertos y método. Deben coincidir
// con el enum engine_type y las reglas del servidor (domain/restoreMapping.js).
// Sin JSX ni dependencias.

export const ENGINES = [
  { key: 'sqlserver', label: 'SQL Server' },
  { key: 'postgres', label: 'PostgreSQL' },
  { key: 'mysql', label: 'MySQL' },
  { key: 'mongodb', label: 'MongoDB' },
];

export const engineLabel = (key) => ENGINES.find((e) => e.key === key)?.label ?? key;

export const DEFAULT_PORTS = { sqlserver: 1433, postgres: 5432, mysql: 3306, mongodb: 27017 };

/** MongoDB no es Cloud SQL: solo restore nativo (mongorestore) y la conexión es obligatoria. */
export const isMongo = (engine) => engine === 'mongodb';

/** Cómo se restaura un job o una tarea, para mostrarlo. */
export function methodLabel(engine, method) {
  if (isMongo(engine)) return 'mongorestore';
  return method === 'native' ? 'restore nativo (pg_restore / psql)' : 'import de Cloud SQL';
}
