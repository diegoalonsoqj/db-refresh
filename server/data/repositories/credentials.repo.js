// Repositorio de credenciales SQL. Las lecturas públicas NUNCA devuelven el
// secreto: solo `has_password` / `secret_ref`. El blob cifrado solo sale por
// getSecretById (uso interno: conexión desde el worker / prueba de conexión).
import { query } from '../pool.js';

const PUBLIC_COLS = `c.id, c.name, c.engine, c.username, c.secret_kind, c.secret_ref, c.description,
  (c.password_enc IS NOT NULL) AS has_password, c.created_at, c.updated_at,
  (SELECT count(*)::int FROM gcp_instances i WHERE i.credential_ref = c.id) AS instance_count`;

export async function listCredentials() {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM sql_credentials c ORDER BY c.name`);
  return rows;
}

export async function getCredentialById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM sql_credentials c WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Uso interno: incluye el secreto cifrado. */
export async function getSecretById(id) {
  const { rows } = await query(
    `SELECT id, name, engine, username, secret_kind, secret_ref, password_enc
       FROM sql_credentials WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createCredential(c) {
  const { rows } = await query(
    `INSERT INTO sql_credentials
       (name, engine, username, secret_kind, password_enc, secret_ref, description, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [c.name, c.engine, c.username, c.secretKind, c.passwordEnc, c.secretRef, c.description, c.updatedBy ?? null],
  );
  return getCredentialById(rows[0].id);
}

/** `passwordEnc` null con secret_kind 'stored' = conservar la contraseña guardada. */
export async function updateCredential(id, c) {
  const { rows } = await query(
    `UPDATE sql_credentials
        SET name = $2, engine = $3, username = $4, secret_kind = $5,
            password_enc = CASE WHEN $5 = 'stored' THEN COALESCE($6, password_enc) ELSE NULL END,
            secret_ref   = CASE WHEN $5 = 'ref' THEN $7 ELSE NULL END,
            description = $8, updated_by = $9, updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [id, c.name, c.engine, c.username, c.secretKind, c.passwordEnc, c.secretRef, c.description, c.updatedBy ?? null],
  );
  return rows[0] ? getCredentialById(id) : null;
}

export async function deleteCredential(id) {
  const { rowCount } = await query(`DELETE FROM sql_credentials WHERE id = $1`, [id]);
  return rowCount > 0;
}
