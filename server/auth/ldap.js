// Autenticación contra Active Directory por LDAP (portado de db-keeper, donde
// está probado contra AD real). Dos modos:
//
// - `direct`: bind directo con DOMINIO\usuario (o usuario@dominio.com), sin
//   cuenta de servicio. Si hay `searchBase`, con esa misma sesión lee nombre y correo.
// - `search` (bind-search-bind): bind con una cuenta de servicio, busca al usuario
//   por filtro para obtener su DN y re-bind con ese DN y la contraseña entregada.
//
// Cifrado: StartTLS (ldap://, se cifra antes de enviar credenciales), LDAPS
// (ldaps://) o sin cifrar (el simple bind envía la contraseña en claro).
//
// La configuración la resuelve settings.service (BD, con fallback a env) y se
// inyecta aquí; este módulo no lee variables de entorno.
import { isIP } from 'node:net';
import { Client } from 'ldapts';
import { logger } from '../lib/logger.js';

export const LDAP_MODES = ['direct', 'search'];
export const LDAP_SECURITY = ['starttls', 'ldaps', 'none'];
export const DEFAULT_USER_FILTER = '(sAMAccountName={{username}})';

const TIMEOUT_MS = 10_000;
const ATTRS = ['dn', 'mail', 'displayName', 'sAMAccountName', 'userPrincipalName'];

/** RFC 4515: escapa metacaracteres para evitar inyección en filtros LDAP. */
export function escapeFilter(value) {
  return String(value).replace(/[\\*()\x00]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function attr(value) {
  if (value == null) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return null;
  return Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
}

/** Abre una conexión y, con StartTLS, la cifra antes de cualquier bind. */
async function connect(config) {
  const host = new URL(config.url).hostname;
  const tlsOptions = {
    rejectUnauthorized: config.tlsRejectUnauthorized,
    // Identidad contra la que se valida el certificado (sin esto StartTLS valida
    // contra "localhost"). SNI no admite IPs: servername solo con nombre de host.
    host,
    ...(isIP(host) ? {} : { servername: host }),
  };
  const client = new Client({
    url: config.url,
    timeout: TIMEOUT_MS,
    connectTimeout: TIMEOUT_MS,
    // "DOMINIO\usuario" no es un DN; ldapts >= 8 lo rechazaría antes de enviarlo.
    strictDN: false,
    // Solo con ldaps://: ldapts abre TLS si recibe cualquier tlsOptions, aun con
    // ldap://, y el DC corta la conexión (ECONNRESET) en el puerto 389.
    ...(/^ldaps:/i.test(config.url) ? { tlsOptions } : {}),
  });
  if (config.security === 'starttls') await client.startTLS(tlsOptions);
  return client;
}

/**
 * Nombre de cuenta (sAMAccountName) a partir de lo que se escribe:
 * "DOMINIO\jperez", "jperez@empresa.com" o "jperez" -> "jperez".
 */
export function normalizeAdUsername(raw) {
  const value = String(raw ?? '').trim();
  const afterDomain = value.slice(value.lastIndexOf('\\') + 1);
  const at = afterDomain.indexOf('@');
  return (at >= 0 ? afterDomain.slice(0, at) : afterDomain).toLowerCase();
}

/** sAMAccountName válido: va dentro del nombre de bind y del filtro de búsqueda. */
export const AD_USERNAME_RE = /^[a-z0-9._-]{1,64}$/i;

/** Nombre de bind del modo direct: usuario@dominio.com (DNS) o DOMINIO\usuario (NetBIOS). */
export function directBindName(domain, username) {
  return domain.includes('.') ? `${username}@${domain}` : `${domain}\\${username}`;
}

/** AD: "invalidCredentials" (49) = usuario/contraseña incorrectos o cuenta bloqueada. */
function isInvalidCredentials(err) {
  return err?.code === 49 || err?.name === 'InvalidCredentialsError';
}

function describe(err) {
  const name = err?.name;
  if (name === 'StrongAuthRequiredError' || name === 'ConfidentialityRequiredError') {
    return 'El servidor AD exige una conexión cifrada: usa StartTLS o LDAPS';
  }
  return err instanceof Error ? err.message : String(err);
}

const INVALID = { ok: false, reason: 'invalid', message: 'Usuario o contraseña inválidos' };

function toUser(entry, username) {
  return {
    username: (attr(entry.sAMAccountName) ?? username).toLowerCase(),
    email: attr(entry.mail) ?? attr(entry.userPrincipalName),
    fullName: attr(entry.displayName),
    dn: entry.dn ?? null,
  };
}

async function readUser(client, config, username) {
  const filter = config.userFilter.replace('{{username}}', escapeFilter(username));
  const { searchEntries } = await client.search(config.searchBase, { scope: 'sub', filter, attributes: ATTRS });
  return searchEntries[0] ? toUser(searchEntries[0], username) : null;
}

async function authenticateDirect(username, password, config) {
  let client = null;
  try {
    client = await connect(config);
    try {
      await client.bind(directBindName(config.domain, username), password);
    } catch (err) {
      if (isInvalidCredentials(err)) return INVALID;
      throw err;
    }
    // Datos del usuario (opcional): con su propia sesión; si falla, el login sigue siendo válido.
    let user = { username, email: null, fullName: null, dn: null };
    if (config.searchBase) {
      try {
        user = (await readUser(client, config, username)) ?? user;
      } catch (err) {
        logger.warn({ err: describe(err) }, 'LDAP: autenticado, pero no se pudieron leer nombre/correo');
      }
    }
    return { ok: true, user };
  } catch (err) {
    return { ok: false, reason: 'error', message: describe(err) };
  } finally {
    await client?.unbind().catch(() => {});
  }
}

async function authenticateSearch(username, password, config) {
  let svc = null;
  try {
    svc = await connect(config);
    await svc.bind(config.bindDn, config.bindPassword);
    const filter = config.userFilter.replace('{{username}}', escapeFilter(username));
    const { searchEntries } = await svc.search(config.searchBase, { scope: 'sub', filter, attributes: ATTRS });
    const entry = searchEntries[0];
    if (!entry) return { ok: false, reason: 'invalid', message: 'Usuario no encontrado en el directorio' };

    // Re-bind como el usuario para validar la contraseña.
    const userClient = await connect(config);
    try {
      await userClient.bind(entry.dn, password);
    } catch (err) {
      if (isInvalidCredentials(err)) return INVALID;
      throw err;
    } finally {
      await userClient.unbind().catch(() => {});
    }
    return { ok: true, user: toUser(entry, username) };
  } catch (err) {
    return { ok: false, reason: 'error', message: describe(err) };
  } finally {
    await svc?.unbind().catch(() => {});
  }
}

/**
 * Autentica y devuelve el detalle: distingue credenciales inválidas ('invalid')
 * de fallos de conexión/config ('error'). Lo usan el login y "Probar AD".
 * @returns {Promise<{ok:true,user:{username,email,fullName,dn}} | {ok:false,reason:'invalid'|'error',message:string}>}
 */
export async function tryAuthenticateLdap(rawUsername, password, config) {
  // En AD un bind con contraseña vacía es un bind anónimo y "funciona": nunca
  // aceptarlo. Se quita el dominio que traiga y se usa siempre el configurado:
  // así no se puede autenticar contra otro dominio.
  const username = normalizeAdUsername(rawUsername);
  if (!password || !AD_USERNAME_RE.test(username)) return INVALID;
  const result =
    config.mode === 'direct'
      ? await authenticateDirect(username, password, config)
      : await authenticateSearch(username, password, config);
  if (!result.ok && result.reason === 'error') {
    logger.error({ err: result.message, mode: config.mode }, 'LDAP: error durante la autenticación');
  }
  return result;
}
