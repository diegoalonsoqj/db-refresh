// Repositorio del RBAC: roles, permisos, asignación a usuarios e identidad efectiva.
import { pool, query } from '../pool.js';

/** Permisos efectivos (unión de los de sus roles) y claves de rol de un usuario. */
export async function getUserAccess(userId) {
  const { rows } = await query(
    `SELECT COALESCE(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM app_user_roles ur
       JOIN app_roles r ON r.id = ur.role_id
       LEFT JOIN app_role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = $1`,
    [userId],
  );
  return { roles: rows[0]?.roles ?? [], permissions: rows[0]?.permissions ?? [] };
}

export async function listPermissions() {
  const { rows } = await query(`SELECT key, category, description FROM app_permissions ORDER BY sort_order, key`);
  return rows;
}

const ROLE_SELECT = `
  SELECT r.id, r.key, r.name, r.description, r.is_system,
         COALESCE(array_agg(rp.permission_key ORDER BY p.sort_order) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
         (SELECT count(*)::int FROM app_user_roles ur WHERE ur.role_id = r.id) AS user_count
    FROM app_roles r
    LEFT JOIN app_role_permissions rp ON rp.role_id = r.id
    LEFT JOIN app_permissions p ON p.key = rp.permission_key`;

export async function listRoles() {
  // Primero los de sistema en orden de poder; luego los personalizados por nombre.
  const { rows } = await query(`${ROLE_SELECT}
    GROUP BY r.id
    ORDER BY r.is_system DESC,
             array_position(ARRAY['superadmin','admin','operator','viewer']::text[], r.key), lower(r.name)`);
  return rows;
}

export async function getRoleById(id) {
  const { rows } = await query(`${ROLE_SELECT} WHERE r.id = $1 GROUP BY r.id`, [id]);
  return rows[0] ?? null;
}

export async function getRoleByKey(key) {
  const { rows } = await query(`${ROLE_SELECT} WHERE r.key = $1 GROUP BY r.id`, [key]);
  return rows[0] ?? null;
}

/** Ids de los roles con esas claves (en el orden recibido; los que no existen no aparecen). */
export async function roleIdsByKeys(keys) {
  const { rows } = await query(`SELECT id, key FROM app_roles WHERE key = ANY($1::text[])`, [keys]);
  return rows;
}

export async function insertRole({ key, name, description }) {
  const { rows } = await query(
    `INSERT INTO app_roles (key, name, description, is_system) VALUES ($1, $2, $3, false) RETURNING id`,
    [key, name, description ?? null],
  );
  return rows[0].id;
}

export async function updateRoleMeta(id, { name, description }) {
  await query(
    `UPDATE app_roles SET name = COALESCE($2, name), description = CASE WHEN $4 THEN $3 ELSE description END WHERE id = $1`,
    [id, name ?? null, description ?? null, description !== undefined],
  );
}

/** Reemplaza los permisos de un rol (transacción). */
export async function setRolePermissions(roleId, permissionKeys) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM app_role_permissions WHERE role_id = $1`, [roleId]);
    if (permissionKeys.length) {
      await client.query(
        `INSERT INTO app_role_permissions (role_id, permission_key) SELECT $1, unnest($2::text[])`,
        [roleId, permissionKeys],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteRole(id) {
  await query(`DELETE FROM app_roles WHERE id = $1`, [id]);
}

/** Reemplaza los roles de un usuario por los de esas claves (transacción). */
export async function setUserRoles(userId, roleKeys) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM app_user_roles WHERE user_id = $1`, [userId]);
    if (roleKeys.length) {
      await client.query(
        `INSERT INTO app_user_roles (user_id, role_id) SELECT $1, id FROM app_roles WHERE key = ANY($2::text[])`,
        [userId, roleKeys],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Cuántos usuarios ACTIVOS tienen el rol superadmin (para no dejar el sistema sin ninguno). */
export async function countActiveSuperadmins(excludeUserId = null) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM app_user_roles ur
       JOIN app_roles r ON r.id = ur.role_id AND r.key = 'superadmin'
       JOIN app_users u ON u.id = ur.user_id AND u.is_active
      WHERE ($1::uuid IS NULL OR u.id <> $1)`,
    [excludeUserId],
  );
  return rows[0].n;
}
