// Borrado de una BD PostgreSQL por SQL con la credencial de la instancia (opción
// «Borrar por SQL» de cada BD al lanzar). Hace falta cuando su owner no es
// cloudsqlsuperuser: el Admin API (databases.delete) se niega a borrarla
// ("must be owner of database"), p.ej. BD creadas por otra herramienta con su
// propio usuario. Equivale a lo que hacía el script Python de restore:
// DROP DATABASE por SQL conectado a la BD `postgres`.
import { DomainError } from '../../domain/errors.js';
import * as pgClient from './pg.client.js';
import { quoteIdent } from './nativeTools.js';

/**
 * Sentencias a ejecutar, en orden y cada una por separado (DROP DATABASE no
 * admite transacción, ni implícita de varias sentencias).
 *  - Sin ser miembro del rol owner no se puede borrar: GRANT del rol a la credencial.
 *  - PG 13+: DROP ... WITH (FORCE) cierra las sesiones abiertas; antes, pg_terminate_backend.
 */
export function buildDropStatements({ database, owner, isMember, serverVersionNum }) {
  const db = quoteIdent(database);
  const stmts = [];
  if (!isMember) stmts.push({ kind: 'grant', sql: `GRANT ${quoteIdent(owner)} TO CURRENT_USER` });
  if (serverVersionNum >= 130000) {
    stmts.push({ kind: 'drop', sql: `DROP DATABASE IF EXISTS ${db} WITH (FORCE)` });
  } else {
    stmts.push({
      kind: 'terminate',
      sql: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(database)} AND pid <> pg_backend_pid()`,
    });
    stmts.push({ kind: 'drop', sql: `DROP DATABASE IF EXISTS ${db}` });
  }
  return stmts;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Borra la BD si existe. -> { existed, owner }
 * @param conn conexión resuelta (engines/sql/connection.js)
 * @param log  async (level, message) => void
 */
export async function dropDatabaseViaSql({ conn, database, log }) {
  return pgClient.withConnection(conn, null, async (client) => {
    const { rows } = await client.query(
      `SELECT pg_get_userbyid(d.datdba) AS owner,
              pg_has_role(current_user, d.datdba, 'MEMBER') AS is_member,
              current_user AS me,
              current_setting('server_version_num')::int AS version_num
         FROM pg_database d WHERE d.datname = $1`,
      [database],
    );
    if (!rows.length) {
      await log('info', `La BD ${database} no existe en la instancia; se creará con la restauración.`);
      return { existed: false, owner: null };
    }
    const { owner, is_member: isMember, me, version_num: serverVersionNum } = rows[0];
    await log('info', `Eliminando la BD existente ${database} por SQL (owner ${owner}, credencial ${me}).`);
    for (const stmt of buildDropStatements({ database, owner, isMember, serverVersionNum })) {
      try {
        await client.query(stmt.sql);
      } catch (err) {
        if (stmt.kind === 'grant') {
          throw new DomainError(
            `No se pudo borrar la BD ${database}: la credencial ${me} no es miembro del rol ${owner} (owner de la BD) ` +
              `y no puede concedérselo (${err.message}). Usa una credencial con ese rol o el propio ${owner}`,
            { code: 'DROP_FAILED', cause: err },
          );
        }
        throw new DomainError(`No se pudo borrar la BD ${database} por SQL: ${err.message}`, { code: 'DROP_FAILED', cause: err });
      }
      if (stmt.kind === 'grant') await log('info', `Concedido el rol ${owner} a ${me} para poder borrar la BD.`);
    }
    return { existed: true, owner };
  });
}
