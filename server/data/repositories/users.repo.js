// Repositorio de app_users. Todas las queries parametrizadas.
// El password_hash SOLO se expone a la estrategia local para verificarlo; nunca
// se devuelve al cliente (los servicios/controladores lo omiten).
import { query } from '../pool.js';
import { setUserRoles } from './rbac.repo.js';
import { SqlWhere, orderBy, pagedQuery } from '../../lib/listQuery.js';

// `roles`: claves de sus roles (RBAC). La columna heredada `role` ya no decide el acceso.
const PUBLIC_COLS = `id, email, username, full_name, auth_source, is_active, last_login_at, created_at,
  (SELECT COALESCE(array_agg(r.key ORDER BY r.key), '{}')
     FROM app_user_roles ur JOIN app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = app_users.id) AS roles`;

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

const USERS_ORDER = {
  user: 'lower(COALESCE(email, username))',
  name: 'lower(full_name)',
  authSource: 'auth_source::text',
  status: 'is_active',
};
export const USER_SORTS = Object.keys(USERS_ORDER);

/** Usuarios paginados (público, sin secretos). Búsqueda: email, usuario y nombre. */
export async function listUsers({ limit, offset, q, sort, dir, filters = {} }) {
  const where = new SqlWhere()
    .search(['email', 'username', 'full_name'], q)
    .eq('auth_source::text', filters.authSource);
  if (filters.active !== undefined) where.add(`is_active = ${where.param(filters.active)}`);
  if (filters.role) {
    where.add(`EXISTS (SELECT 1 FROM app_user_roles ur JOIN app_roles r ON r.id = ur.role_id
                WHERE ur.user_id = app_users.id AND r.key = ${where.param(filters.role)})`);
  }
  return pagedQuery(query, {
    select: `SELECT ${PUBLIC_COLS} FROM app_users`,
    countFrom: 'app_users',
    where,
    order: orderBy(USERS_ORDER, sort, dir, { sort: 'user', dir: 'asc' }, 'id'),
    limit,
    offset,
  });
}

/** Crea un usuario local (sin roles: se asignan aparte). Lanza (23505) si el email ya existe. */
export async function insertLocalUser({ email, fullName, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, full_name, auth_source, password_hash, is_active)
          VALUES ($1, $2, 'local', $3, true)
       RETURNING id`,
    [email, fullName ?? null, passwordHash],
  );
  return rows[0].id;
}

/**
 * Actualiza estado / nombre / email (solo los campos provistos: `undefined` = no
 * se toca; `null` en nombre o email = se vacía). Los roles van por rbac.repo.setUserRoles.
 */
export async function updateUserFields(id, { isActive, fullName, email }) {
  await query(
    `UPDATE app_users
        SET is_active = COALESCE($2, is_active),
            full_name = CASE WHEN $4 THEN $3 ELSE full_name END,
            email     = CASE WHEN $6 THEN $5 ELSE email END
      WHERE id = $1`,
    [id, isActive ?? null, fullName ?? null, fullName !== undefined, email ?? null, email !== undefined],
  );
  return getUserById(id);
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
export async function insertAdUser({ username, email, fullName }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, username, full_name, auth_source, is_active)
          VALUES ($1, $2, $3, 'ad', true)
       RETURNING id`,
    [email ?? null, username, fullName ?? null],
  );
  return rows[0].id;
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
 * Crea o actualiza un usuario local (seed de admin y tests). Idempotente por
 * email: si existe, actualiza hash/estado y deja exactamente esos roles.
 */
export async function upsertLocalUser({ email, fullName, roles = ['viewer'], passwordHash }) {
  const { rows } = await query(
    `INSERT INTO app_users (email, full_name, auth_source, password_hash, is_active)
          VALUES ($1, $2, 'local', $3, true)
     ON CONFLICT (email) DO UPDATE
          SET full_name     = EXCLUDED.full_name,
              auth_source   = 'local',
              password_hash = EXCLUDED.password_hash,
              is_active     = true
       RETURNING id`,
    [email, fullName ?? null, passwordHash],
  );
  await setUserRoles(rows[0].id, roles);
  return getUserById(rows[0].id);
}
