// Cliente MongoDB (driver oficial) para lo que no es el restore en sí: probar la
// conexión, listar BDs y borrar la BD destino. El restore lo hace mongorestore.
import { MongoClient } from 'mongodb';
import { InfraError } from '../../domain/errors.js';
import { buildMongoUri, mongoLabel, MONGO_SYSTEM_DATABASES } from '../../domain/mongo.js';

const TIMEOUT_MS = 15_000;

/** Abre un cliente, ejecuta fn(client) y lo cierra siempre. */
export async function withClient(conn, fn) {
  const client = new MongoClient(buildMongoUri(conn), {
    serverSelectionTimeoutMS: TIMEOUT_MS,
    connectTimeoutMS: TIMEOUT_MS,
    appName: 'db-refresh',
  });
  try {
    await client.connect();
    return await fn(client);
  } catch (err) {
    if (err instanceof InfraError) throw err;
    // El mensaje del driver no lleva la contraseña; se añade a quién se intentó conectar.
    throw new InfraError(`MongoDB ${mongoLabel(conn)}: ${err.message}`, { code: 'MONGO_CONNECTION_FAILED', cause: err });
  } finally {
    await client.close().catch(() => {});
  }
}

/** Login + ping. Lanza si falla. */
export function ping(conn) {
  return withClient(conn, (client) => client.db('admin').command({ ping: 1 }));
}

/** BDs de usuario (sin admin/config/local), ordenadas por nombre. -> [{ name, sizeOnDisk }] */
export function listDatabases(conn) {
  return withClient(conn, async (client) => {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: false });
    return databases
      .filter((d) => !MONGO_SYSTEM_DATABASES.includes(d.name))
      .map((d) => ({ name: d.name, sizeOnDisk: d.sizeOnDisk ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/**
 * Borra la BD si existe. -> true si se borró, false si no existía.
 * (Una BD sin colecciones no aparece en listDatabases: para Mongo no existe.)
 */
export function dropDatabaseIfExists(conn, database) {
  return withClient(conn, async (client) => {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
    if (!databases.some((d) => d.name === database)) return false;
    await client.db(database).dropDatabase();
    return true;
  });
}

/** Versión del servidor (p.ej. "7.0.14"), para el log del job. */
export function serverVersion(conn) {
  return withClient(conn, async (client) => (await client.db('admin').command({ buildInfo: 1 })).version);
}
