// Garantiza un usuario admin base en la BD al arrancar la API, para no quedar
// bloqueado (auth local). Idempotente: si ya existe NO toca su password (respeta
// un cambio manual). Si fue borrado, se vuelve a crear en el próximo arranque.
import { config } from '../config/index.js';
import { getUserByEmailForAuth } from '../data/repositories/users.repo.js';
import { upsertLocalUser } from '../data/repositories/users.repo.js';
import { hashPassword } from './strategies/local.js';
import { logger } from '../lib/logger.js';

export async function ensureBaseAdmin() {
  const { enabled, email, password } = config.auth.baseAdmin;
  if (!enabled) return;

  const existing = await getUserByEmailForAuth(email);
  if (existing) {
    logger.info({ email }, 'Admin base ya presente');
    return;
  }

  const passwordHash = await hashPassword(password);
  await upsertLocalUser({ email, fullName: 'Administrador base', role: 'admin', passwordHash });
  logger.warn(
    { email },
    'Admin base creado con password por defecto — cámbialo cuanto antes',
  );
}
