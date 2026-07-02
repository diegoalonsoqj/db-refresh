// Repositorio de app_users. Todas las queries parametrizadas.
// El password_hash SOLO se expone a la estrategia local para verificarlo; nunca
// se devuelve al cliente (los servicios/controladores lo omiten).
import { query } from '../pool.js';

const PUBLIC_COLS = `id, email, full_name, role, auth_source, is_active, last_login_at, created_at`;

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
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM app_users ORDER BY email`);
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

/**
 * Crea o actualiza un usuario de AD tras un login exitoso. Idempotente por email.
 * En creación asigna `role` (rol por defecto de AD); en actualización CONSERVA el
 * rol existente (un admin pudo haberlo cambiado) y solo refresca datos de AD.
 */
export async function upsertAdUser({ email, fullName, adDn, role }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, full_name, role, auth_source, ad_dn, is_active)
          VALUES ($1, $2, $3, 'ad', $4, true)
     ON CONFLICT (email) DO UPDATE
          SET full_name   = EXCLUDED.full_name,
              auth_source = 'ad',
              ad_dn       = EXCLUDED.ad_dn,
              is_active   = true
       RETURNING ${PUBLIC_COLS}`,
    [email, fullName ?? null, role, adDn],
  );
  return rows[0];
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
