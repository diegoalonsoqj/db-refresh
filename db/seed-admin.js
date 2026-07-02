// Seed del primer usuario admin (auth local, argon2). Idempotente por email.
// Uso:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin
//   node db/seed-admin.js <email> <password> ["Nombre completo"]
// El password NUNCA se guarda en claro: se hashea con argon2id.
import { hashPassword } from '../server/auth/strategies/local.js';
import { upsertLocalUser } from '../server/data/repositories/users.repo.js';
import { closePool } from '../server/data/pool.js';
import { logger } from '../server/lib/logger.js';

async function main() {
  const email = process.env.ADMIN_EMAIL ?? process.argv[2];
  const password = process.env.ADMIN_PASSWORD ?? process.argv[3];
  const fullName = process.env.ADMIN_NAME ?? process.argv[4] ?? 'Administrador';

  if (!email || !password) {
    throw new Error('Faltan credenciales: define ADMIN_EMAIL y ADMIN_PASSWORD (o pásalos como argumentos)');
  }
  if (password.length < 10) {
    throw new Error('El password del admin debe tener al menos 10 caracteres');
  }

  const passwordHash = await hashPassword(password);
  const user = await upsertLocalUser({ email, fullName, role: 'admin', passwordHash });
  logger.info({ id: user.id, email: user.email, role: user.role }, 'Admin creado/actualizado');
}

main()
  .catch((err) => {
    logger.error({ err: err.message }, 'Fallo al crear el admin');
    process.exitCode = 1;
  })
  .finally(closePool);
