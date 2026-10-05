// Asigna el owner de una BD PostgreSQL por SQL con la credencial de la instancia.
// Lo usa el import de Cloud SQL con owner elegido (importUser): la BD recién creada
// por el Admin API es de cloudsqlsuperuser y el import, que corre como importUser,
// no podría crear esquemas en ella ("permission denied for database").
import { DomainError } from '../../domain/errors.js';
import * as pgClient from './pg.client.js';
import { quoteIdent } from './nativeTools.js';

/** Sentencias en orden: GRANT del rol si la credencial no es miembro (ALTER ... OWNER lo exige). */
export function buildOwnerStatements({ database, role, isMember }) {
  const stmts = [];
  if (!isMember) stmts.push({ kind: 'grant', sql: `GRANT ${quoteIdent(role)} TO CURRENT_USER` });
  stmts.push({ kind: 'alter', sql: `ALTER DATABASE ${quoteIdent(database)} OWNER TO ${quoteIdent(role)}` });
  return stmts;
}

/**
 * @param conn conexión resuelta (engines/sql/connection.js)
 * @param log  async (level, message) => void
 */
export async function setDatabaseOwner({ conn, database, role, log }) {
  await pgClient.withConnection(conn, null, async (client) => {
    const { rows } = await client.query(
      `SELECT current_user AS me,
              EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
              CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
                   THEN pg_has_role(current_user, $1, 'MEMBER') ELSE false END AS is_member`,
      [role],
    );
    const { me, role_exists: roleExists, is_member: isMember } = rows[0];
    if (!roleExists) {
      throw new DomainError(`El usuario ${role} no existe en la instancia: no se puede asignar como owner de ${database}`, {
        code: 'OWNER_NOT_FOUND',
      });
    }
    await log('info', `Asignando ${role} como owner de la BD ${database} (credencial ${me}).`);
    for (const stmt of buildOwnerStatements({ database, role, isMember })) {
      try {
        await client.query(stmt.sql);
      } catch (err) {
        const why = stmt.kind === 'grant'
          ? `la credencial ${me} no es miembro del rol ${role} y no puede concedérselo`
          : 'falló ALTER DATABASE ... OWNER';
        throw new DomainError(`No se pudo asignar ${role} como owner de ${database}: ${why} (${err.message})`, {
          code: 'SET_OWNER_FAILED',
          cause: err,
        });
      }
    }
  });
}
