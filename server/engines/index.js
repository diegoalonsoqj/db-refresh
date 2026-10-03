// Factory de adaptadores por motor. Añadir un 4º motor = registrar aquí,
// sin tocar el core (worker/servicios).
import { SqlServerAdapter } from './sqlserver/SqlServerAdapter.js';
import { PostgresAdapter } from './postgres/PostgresAdapter.js';
import { MySqlAdapter } from './mysql/MySqlAdapter.js';
import { PgNativeAdapter } from './postgres/PgNativeAdapter.js';
import { DomainError } from '../domain/errors.js';

const REGISTRY = {
  sqlserver: SqlServerAdapter,
  postgres: PostgresAdapter,
  mysql: MySqlAdapter,
};

/**
 * @param method 'import' (Cloud SQL Admin API) | 'native' (pg_restore/psql, solo PostgreSQL)
 */
export function createAdapter(engine, ctx, method = 'import') {
  if (method === 'native') {
    if (engine !== 'postgres') {
      throw new DomainError(`Restore nativo no disponible para ${engine}`, { code: 'ENGINE_UNSUPPORTED' });
    }
    return new PgNativeAdapter(ctx);
  }
  const Adapter = REGISTRY[engine];
  if (!Adapter) {
    throw new DomainError(`Motor no soportado: ${engine}`, { code: 'ENGINE_UNSUPPORTED' });
  }
  return new Adapter(ctx);
}

export function supportedEngines() {
  return Object.keys(REGISTRY);
}
