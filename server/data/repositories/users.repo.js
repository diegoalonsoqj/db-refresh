// Repositorio de app_users. Todas las queries parametrizadas.
// El password_hash SOLO se expone a la estrategia local para verificarlo; nunca
// se devuelve al cliente (los servicios/controladores lo omiten).
import { query } from '../pool.js';

const PUBLIC_COLS = `id, email, username, full_name, role, auth_source, is_active, last_login_at, created_at`;

/** Usuario por email, incluyendo password_hash y ad_dn (para autenticar). */
export async function getUserByEmailForAuth(email) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLS}, password_hash, ad_dn
       FROM app_users
      WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

/** Usuario de AD por su cuenta (sAMAccountName, sin dominio). */
export async function getAdUserByUsername(username) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLS}, ad_dn
       FROM app_users
      WHERE auth_source = 'ad' AND lower(username) = lower($1)`,
    [username],
  );
  return rows[0] ?? null;
}

/** Usuario público por id (sin secretos). */
export async function getUserById(id) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLS} FROM app_users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Marca el último login. */
export async function touchLastLogin(id) {
  await query(`UPDATE app_users SET last_login_at = now() WHERE id = $1`, [id]);
}

/** Lista usuarios (público, sin secretos). */
export async function listUsers() {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM app_users ORDER BY lower(COALESCE(email, username))`);
  return rows;
}

/** Crea un usuario local. Lanza (23505) si el email ya existe. */
export async function insertLocalUser({ email, fullName, role, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, full_name, role, auth_source, password_hash, is_active)
          VALUES ($1, $2, $3, 'local', $4, true)
       RETURNING ${PUBLIC_COLS}`,
    [email, fullName ?? null, role, passwordHash],
  );
  return rows[0];
}

/** Actualiza rol / estado / nombre (solo campos provistos). */
export async function updateUserFields(id, { role, isActive, fullName }) {
  const { rows } = await query(
    `UPDATE app_users
        SET role      = COALESCE($2, role),
            is_active = COALESCE($3, is_active),
            full_name = COALESCE($4, full_name)
      WHERE id = $1
      RETURNING ${PUBLIC_COLS}`,
    [id, role ?? null, isActive ?? null, fullName ?? null],
  );
  return rows[0] ?? null;
}

/** Fija un nuevo hash de password (auth local). */
export async function setPasswordHash(id, passwordHash) {
  await query(`UPDATE app_users SET password_hash = $2 WHERE id = $1`, [id, passwordHash]);
}

export async function deleteUser(id) {
  const { rowCount } = await query(`DELETE FROM app_users WHERE id = $1`, [id]);
  return rowCount > 0;
}

/** Alta de un usuario de AD por un admin (sin password: se valida contra el directorio). */
export async function insertAdUser({ username, email, fullName, role }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, username, full_name, role, auth_source, is_active)
          VALUES ($1, $2, $3, $4, 'ad', true)
       RETURNING ${PUBLIC_COLS}`,
    [email ?? null, username, fullName ?? null, role],
  );
  return rows[0];
}

/**
 * Tras un login AD correcto, refresca lo que da el directorio (nombre, DN y,
 * si no tenía, el correo). No toca rol ni estado: los gestiona el admin.
 */
export async function refreshAdProfile(id, { fullName, email, adDn }) {
  const { rows } = await query(
    `UPDATE app_users
        SET full_name = COALESCE($2, full_name),
            email     = COALESCE(email, $3),
            ad_dn     = COALESCE($4, ad_dn)
      WHERE id = $1
      RETURNING ${PUBLIC_COLS}`,
    [id, fullName ?? null, email ?? null, adDn ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Crea o actualiza un usuario local (usado por el seed de admin). Idempotente
 * por email: si existe, actualiza hash/rol/estado.
 */
export async function upsertLocalUser({ email, fullName, role, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, full_name, role, auth_source, password_hash, is_active)
          VALUES ($1, $2, $3, 'local', $4, true)
     ON CONFLICT (email) DO UPDATE
          SET full_name     = EXCLUDED.full_name,
              role          = EXCLUDED.role,
              auth_source   = 'local',
              password_hash = EXCLUDED.password_hash,
              is_active     = true
       RETURNING ${PUBLIC_COLS}`,
    [email, fullName ?? null, role, passwordHash],
  );
  return rows[0];
}
