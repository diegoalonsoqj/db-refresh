// Factory de adaptadores por motor. Añadir un 4º motor = registrar aquí,
// sin tocar el core (worker/servicios).
import { SqlServerAdapter } from './sqlserver/SqlServerAdapter.js';
import { PostgresAdapter } from './postgres/PostgresAdapter.js';
import { MySqlAdapter } from './mysql/MySqlAdapter.js';
import { DomainError } from '../domain/errors.js';

const REGISTRY = {
  sqlserver: SqlServerAdapter,
  postgres: PostgresAdapter,
  mysql: MySqlAdapter,
};

export function createAdapter(engine, ctx) {
  const Adapter = REGISTRY[engine];
  if (!Adapter) {
    throw new DomainError(`Motor no soportado: ${engine}`, { code: 'ENGINE_UNSUPPORTED' });
  }
  return new Adapter(ctx);
}

export function supportedEngines() {
  return Object.keys(REGISTRY);
}
