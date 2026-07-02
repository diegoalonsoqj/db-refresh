// Repositorio de app_settings (clave/valor con secreto cifrado). Parametrizado.
import { query } from '../pool.js';

/** Devuelve la fila de settings por key, o null. secret_enc es Buffer|null. */
export async function getSetting(key) {
  const { rows } = await query(
    `SELECT key, value, secret_enc, updated_at, updated_by
       FROM app_settings
      WHERE key = $1`,
    [key],
  );
  return rows[0] ?? null;
}

/**
 * Inserta o actualiza un setting. Si `secretEnc` es null se CONSERVA el secreto
 * existente (útil para editar campos no secretos sin re-enviar el password/JSON).
 * @param {string} key
 * @param {object} value       campos no secretos (se serializa a jsonb)
 * @param {Buffer|null} secretEnc  blob cifrado o null para no tocar el actual
 * @param {string|null} updatedBy  uuid del usuario
 */
export async function upsertSetting(key, value, secretEnc, updatedBy) {
  const { rows } = await query(
    `INSERT INTO app_settings (key, value, secret_enc, updated_by, updated_at)
          VALUES ($1, $2::jsonb, $3, $4, now())
     ON CONFLICT (key) DO UPDATE
          SET value      = EXCLUDED.value,
              secret_enc = COALESCE(EXCLUDED.secret_enc, app_settings.secret_enc),
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
       RETURNING key, value, updated_at`,
    [key, JSON.stringify(value ?? {}), secretEnc, updatedBy],
  );
  return rows[0];
}
