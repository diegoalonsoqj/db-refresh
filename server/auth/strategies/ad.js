// Estrategia de autenticación AD/LDAP. Como en db-keeper, los usuarios de AD
// deben existir antes en app_users (los da de alta un admin en Usuarios, tipo AD):
// aquí solo se valida la contraseña contra el directorio con la config del
// módulo de settings (BD, con fallback a env) y se refrescan nombre/correo.
import { tryAuthenticateLdap } from '../ldap.js';
import { getAdRuntimeConfig } from '../../services/settings.service.js';
import { refreshAdProfile } from '../../data/repositories/users.repo.js';
import { AuthError } from '../../domain/errors.js';
import { logger } from '../../lib/logger.js';

// Re-export para compatibilidad (tests y código previo lo importaban de aquí).
export { escapeFilter } from '../ldap.js';

/**
 * Valida la contraseña de un usuario AD ya provisionado (`user` = fila de
 * app_users con auth_source='ad'). Devuelve el usuario público actualizado o
 * lanza AuthError (mensaje genérico; el motivo va en `code` para la auditoría).
 */
export async function verifyAd(user, password) {
  const cfg = await getAdRuntimeConfig();
  if (!cfg) {
    throw new AuthError('Credenciales inválidas', { code: 'AD_NOT_CONFIGURED' });
  }
  const r = await tryAuthenticateLdap(user.username, password, cfg);
  if (!r.ok) {
    // 'error' = no se pudo hablar con AD (red/TLS/config): se loguea en ldap.js y
    // se responde igual que credenciales inválidas para no filtrar información.
    throw new AuthError('Credenciales inválidas', {
      code: r.reason === 'error' ? 'AD_UNAVAILABLE' : 'INVALID_CREDENTIALS',
    });
  }

  let updated = user;
  try {
    updated = (await refreshAdProfile(user.id, r.user)) ?? user;
  } catch (err) {
    // p. ej. el correo del directorio ya lo usa otra cuenta: el login sigue siendo válido.
    logger.warn({ userId: user.id, err: err.message }, 'Login AD: no se pudo refrescar el perfil');
  }
  const { ad_dn, ...publicUser } = updated;
  logger.info({ userId: user.id, username: user.username }, 'Login AD correcto');
  return publicUser;
}
