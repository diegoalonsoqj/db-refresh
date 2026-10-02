// Servicio de settings: AD/LDAP y service account de GCP.
// - Persiste campos no secretos en app_settings.value y el secreto cifrado en
//   app_settings.secret_enc (AES-256-GCM).
// - Los GET públicos NUNCA devuelven el secreto, solo metadata.
// - Expone getters internos (getAdRuntimeConfig / getSaCredentials) para que el
//   resto del backend consuma la config sin conocer el cifrado.
import { tryAuthenticateLdap, LDAP_MODES, LDAP_SECURITY, DEFAULT_USER_FILTER } from '../auth/ldap.js';
import { GoogleAuth } from 'google-auth-library';
import { getSetting, upsertSetting } from '../data/repositories/settings.repo.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { invalidateGcp } from '../gcp/state.js';
import { config } from '../config/index.js';
import { ValidationError } from '../domain/errors.js';
import { logger } from '../lib/logger.js';

const AD_KEY = 'auth.ad';
const GCP_KEY = 'gcp.service_account';
const GCP_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

// ---------------------------------------------------------------------------
// AD / LDAP
// ---------------------------------------------------------------------------

// Forma guardada en app_settings['auth.ad'].value (la contraseña de bind va
// cifrada en secret_enc):
//   { enabled, mode, domain, security, url, bindDn, searchBase, userFilter, tlsRejectUnauthorized }
// Configs previas guardaban { url, baseDn, bindDn }: se completan en withAdDefaults.

const DOMAIN_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/; // NetBIOS (DOMINIO) o DNS (empresa.com)

/** Seguridad implícita en la URL (configs previas a este campo): ldaps:// -> LDAPS. */
function securityFromUrl(url) {
  return /^ldaps:\/\//i.test(url ?? '') ? 'ldaps' : 'none';
}

/** Completa los campos de una config guardada antes de existir (no cambia su comportamiento). */
export function withAdDefaults(v = {}) {
  const url = (v.url ?? '').trim();
  return {
    enabled: v.enabled ?? Boolean(url),
    mode: v.mode ?? 'search',
    domain: v.domain ?? '',
    security: v.security ?? securityFromUrl(url),
    url,
    bindDn: v.bindDn ?? '',
    searchBase: v.searchBase ?? v.baseDn ?? '',
    userFilter: v.userFilter || DEFAULT_USER_FILTER,
    tlsRejectUnauthorized: v.tlsRejectUnauthorized ?? true,
  };
}

/** Config AD desde env (fallback si no hay nada en la BD). */
function adFromEnv() {
  const e = config.auth.ad;
  if (!e.url) return null;
  return {
    ...withAdDefaults({
      enabled: true,
      mode: e.mode,
      domain: e.domain,
      security: e.security,
      url: e.url,
      bindDn: e.bindDn,
      searchBase: e.baseDn,
      userFilter: e.userFilter,
      tlsRejectUnauthorized: e.tlsRejectUnauthorized,
    }),
    bindPassword: e.bindPassword ?? '',
  };
}

/**
 * Coherencia URL <-> cifrado y campos obligatorios del modo (solo si está
 * habilitado). Lanza ValidationError. Pura: `hasBindPassword` indica si hay
 * contraseña de bind (nueva o ya guardada).
 */
export function validateAd(s, { hasBindPassword }) {
  if (!LDAP_MODES.includes(s.mode)) throw new ValidationError(`mode inválido: ${s.mode}`);
  if (!LDAP_SECURITY.includes(s.security)) throw new ValidationError(`security inválido: ${s.security}`);
  if (s.url) {
    if (!/^ldaps?:\/\//i.test(s.url)) throw new ValidationError('La URL debe empezar con ldap:// o ldaps://');
    const isLdaps = /^ldaps:\/\//i.test(s.url);
    if (s.security === 'ldaps' && !isLdaps) throw new ValidationError('Con LDAPS la URL debe empezar con ldaps:// (puerto 636)');
    if (s.security !== 'ldaps' && isLdaps) throw new ValidationError('Con StartTLS o sin cifrar la URL debe empezar con ldap:// (puerto 389)');
  }
  if (s.domain && !DOMAIN_RE.test(s.domain)) throw new ValidationError('Dominio inválido (p. ej. EMPRESA o empresa.com)');
  if (!s.userFilter.includes('{{username}}')) throw new ValidationError('El filtro de usuario debe contener {{username}}');
  if (!s.enabled) return;
  if (!s.url) throw new ValidationError('Indica la URL del servidor AD');
  if (s.mode === 'direct' && !s.domain) throw new ValidationError('Indica el dominio para el bind directo');
  if (s.mode === 'search' && (!s.bindDn || !hasBindPassword || !s.searchBase)) {
    throw new ValidationError('Con cuenta de servicio indica Bind DN, su contraseña y la base de búsqueda');
  }
}

/** Config AD pública (sin la contraseña de bind, solo si existe) + su origen. */
export async function getAdSettings() {
  const row = await getSetting(AD_KEY);
  if (row) {
    return {
      source: 'db',
      ...withAdDefaults(row.value ?? {}),
      hasBindPassword: Boolean(row.secret_enc),
      updatedAt: row.updated_at,
    };
  }
  const env = adFromEnv();
  if (env) {
    const { bindPassword, ...pub } = env;
    return { source: 'env', ...pub, hasBindPassword: Boolean(bindPassword), updatedAt: null };
  }
  return { source: null, ...withAdDefaults({}), hasBindPassword: false, updatedAt: null };
}

/**
 * Actualiza la config AD (merge sobre lo guardado). Si `bindPassword` viene
 * vacío/omitido se conserva la guardada.
 */
export async function updateAdSettings(input = {}, updatedBy = null) {
  const row = await getSetting(AD_KEY);
  const current = withAdDefaults(row?.value ?? {});
  const str = (k) => (typeof input[k] === 'string' ? input[k].trim() : current[k]);
  const next = {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
    mode: str('mode'),
    domain: str('domain'),
    security: str('security'),
    url: str('url'),
    bindDn: str('bindDn'),
    searchBase: str('searchBase'),
    userFilter: str('userFilter') || DEFAULT_USER_FILTER,
    tlsRejectUnauthorized:
      input.tlsRejectUnauthorized !== undefined ? Boolean(input.tlsRejectUnauthorized) : current.tlsRejectUnauthorized,
  };
  const bindPassword = typeof input.bindPassword === 'string' ? input.bindPassword : '';
  validateAd(next, { hasBindPassword: Boolean(bindPassword || row?.secret_enc) });

  const secretEnc = bindPassword ? encrypt(bindPassword) : null; // null = conservar
  const saved = await upsertSetting(AD_KEY, next, secretEnc, updatedBy);
  logger.info({ updatedBy, mode: next.mode, enabled: next.enabled }, 'Config AD actualizada');
  return getAdSettings().then((s) => ({ ...s, updatedAt: saved.updated_at }));
}

/**
 * Config AD lista para autenticar (con la contraseña de bind descifrada), o null
 * si AD no está habilitado o le faltan datos. BD primero; si no hay fila, env.
 */
export async function getAdRuntimeConfig() {
  const row = await getSetting(AD_KEY);
  const s = row
    ? { ...withAdDefaults(row.value ?? {}), bindPassword: row.secret_enc ? decrypt(row.secret_enc) : '' }
    : adFromEnv();
  if (!s || !s.enabled || !s.url) return null;
  if (s.mode === 'direct' && s.domain) return s;
  if (s.mode === 'search' && s.bindDn && s.bindPassword && s.searchBase) return s;
  return null;
}

/**
 * "Probar AD": autentica un usuario real con la config GUARDADA. La contraseña
 * no se guarda ni se loguea. Devuelve { ok, message, fullName, email }.
 */
export async function testAd({ username, password } = {}) {
  const cfg = await getAdRuntimeConfig();
  if (!cfg) {
    return { ok: false, message: 'AD no está habilitado o le faltan datos: guarda la configuración primero' };
  }
  if (!username || !password) return { ok: false, message: 'Indica usuario y contraseña de AD para probar' };
  const r = await tryAuthenticateLdap(username, password, cfg);
  if (r.ok) {
    return { ok: true, message: `Autenticación correcta (${r.user.username})`, fullName: r.user.fullName, email: r.user.email };
  }
  const message = r.reason === 'invalid' ? r.message : `No se pudo conectar o autenticar con AD: ${r.message}`;
  return { ok: false, message };
}

// ---------------------------------------------------------------------------
// GCP service account
// ---------------------------------------------------------------------------

/** Normaliza el body a un objeto SA sin importar el formato de entrada. */
function parseServiceAccount(body) {
  let obj = body;
  try {
    if (typeof body === 'string') obj = JSON.parse(body);
    else if (typeof body?.json === 'string') obj = JSON.parse(body.json);
    else if (body?.json && typeof body.json === 'object') obj = body.json;
    else if (typeof body?.content === 'string') obj = JSON.parse(body.content);
    else if (body?.serviceAccount) obj = body.serviceAccount;
  } catch {
    throw new ValidationError('El contenido no es JSON válido');
  }
  if (!obj || typeof obj !== 'object') {
    throw new ValidationError('Se esperaba el JSON de la service account');
  }
  const missing = ['type', 'project_id', 'client_email', 'private_key'].filter((k) => !obj[k]);
  if (missing.length) {
    throw new ValidationError('JSON de service account incompleto', { missing });
  }
  if (obj.type !== 'service_account') {
    throw new ValidationError(`type debe ser "service_account", recibido "${obj.type}"`);
  }
  return obj;
}

/** Metadata pública de la SA (sin private_key). */
export async function getGcpSettings() {
  const row = await getSetting(GCP_KEY);
  if (row && row.secret_enc) {
    const v = row.value ?? {};
    return {
      source: 'db',
      configured: true,
      clientEmail: v.client_email ?? null,
      projectId: v.project_id ?? null,
      updatedAt: row.updated_at,
    };
  }
  const adcPath = config.gcp.credentialsPath;
  return {
    source: adcPath ? 'env' : null,
    configured: Boolean(adcPath),
    clientEmail: null,
    projectId: null,
    updatedAt: null,
  };
}

/** Guarda (cifrada) la service account subida/pegada y refresca los clientes GCP. */
export async function updateGcpServiceAccount(body, updatedBy = null) {
  const sa = parseServiceAccount(body);
  const value = {
    type: sa.type,
    project_id: sa.project_id,
    client_email: sa.client_email,
  };
  const secretEnc = encrypt(JSON.stringify(sa));
  const saved = await upsertSetting(GCP_KEY, value, secretEnc, updatedBy);
  invalidateGcp(); // fuerza a los clientes a reconstruirse con las nuevas creds
  logger.info({ updatedBy, clientEmail: sa.client_email }, 'Service account GCP actualizada');
  return {
    ok: true,
    source: 'db',
    clientEmail: sa.client_email,
    projectId: sa.project_id,
    updatedAt: saved.updated_at,
  };
}

/**
 * Credenciales de la SA para los clientes GCP. Devuelve { credentials, projectId }
 * o null para que el cliente use ADC (GOOGLE_APPLICATION_CREDENTIALS / WI).
 */
export async function getSaCredentials() {
  const row = await getSetting(GCP_KEY);
  if (!row || !row.secret_enc) return null;
  const credentials = JSON.parse(decrypt(row.secret_enc));
  return { credentials, projectId: credentials.project_id };
}

/** Prueba de credenciales GCP: intenta obtener un access token. */
export async function testGcp() {
  const sa = await getSaCredentials();
  const auth = new GoogleAuth({
    scopes: GCP_SCOPES,
    ...(sa ? { credentials: sa.credentials } : {}),
  });
  try {
    const token = await auth.getAccessToken();
    return {
      ok: Boolean(token),
      source: sa ? 'db' : 'adc',
      clientEmail: sa?.credentials.client_email ?? null,
      projectId: sa?.projectId ?? null,
    };
  } catch (err) {
    return { ok: false, source: sa ? 'db' : 'adc', error: err.message ?? 'Fallo al autenticar con GCP' };
  }
}
