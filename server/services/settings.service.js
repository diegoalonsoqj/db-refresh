// Servicio de settings: AD/LDAP y service account de GCP.
// - Persiste campos no secretos en app_settings.value y el secreto cifrado en
//   app_settings.secret_enc (AES-256-GCM).
// - Los GET públicos NUNCA devuelven el secreto, solo metadata.
// - Expone getters internos (getAdCredentials / getSaCredentials) para que el
//   resto del backend consuma la config sin conocer el cifrado.
import { Client as LdapClient } from 'ldapts';
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

/** Metadata pública de la config AD (sin password). */
export async function getAdSettings() {
  const row = await getSetting(AD_KEY);
  if (row) {
    const v = row.value ?? {};
    return {
      source: 'db',
      url: v.url ?? null,
      baseDn: v.baseDn ?? null,
      bindDn: v.bindDn ?? null,
      hasBindPassword: Boolean(row.secret_enc),
      updatedAt: row.updated_at,
    };
  }
  // Fallback a variables de entorno si no hay config en la BD.
  const env = config.auth.ad;
  const configuredInEnv = Boolean(env.url || env.baseDn || env.bindDn);
  return {
    source: configuredInEnv ? 'env' : null,
    url: env.url ?? null,
    baseDn: env.baseDn ?? null,
    bindDn: env.bindDn ?? null,
    hasBindPassword: Boolean(env.bindPassword),
    updatedAt: null,
  };
}

/**
 * Actualiza la config AD. Si `bindPassword` viene vacío/omitido se conserva el
 * password guardado. url/baseDn/bindDn son obligatorios.
 */
export async function updateAdSettings(input = {}, updatedBy = null) {
  const url = (input.url ?? '').trim();
  const baseDn = (input.baseDn ?? '').trim();
  const bindDn = (input.bindDn ?? '').trim();
  const bindPassword = input.bindPassword ?? '';

  const missing = [];
  if (!url) missing.push('url');
  if (!baseDn) missing.push('baseDn');
  if (!bindDn) missing.push('bindDn');
  if (missing.length) {
    throw new ValidationError('Config AD incompleta', { missing });
  }
  if (!/^ldaps?:\/\//i.test(url)) {
    throw new ValidationError('url debe empezar con ldap:// o ldaps://');
  }

  const value = { url, baseDn, bindDn };
  const secretEnc = bindPassword ? encrypt(bindPassword) : null;
  const saved = await upsertSetting(AD_KEY, value, secretEnc, updatedBy);
  logger.info({ updatedBy }, 'Config AD actualizada');
  return { ok: true, source: 'db', updatedAt: saved.updated_at };
}

/**
 * Credenciales AD para uso interno (estrategia de auth AD, aún no implementada).
 * Devuelve { url, baseDn, bindDn, bindPassword } o null si no hay config.
 */
export async function getAdCredentials() {
  const row = await getSetting(AD_KEY);
  if (row) {
    const v = row.value ?? {};
    return {
      url: v.url,
      baseDn: v.baseDn,
      bindDn: v.bindDn,
      bindPassword: row.secret_enc ? decrypt(row.secret_enc) : '',
    };
  }
  const env = config.auth.ad;
  if (!env.url) return null;
  return {
    url: env.url,
    baseDn: env.baseDn,
    bindDn: env.bindDn,
    bindPassword: env.bindPassword ?? '',
  };
}

/**
 * Prueba de conexión LDAP (bind). Usa el password del input o, si no viene, el
 * guardado. Devuelve resultado estructurado (no lanza en fallo de credenciales).
 */
export async function testAd(input = {}) {
  const stored = await getAdCredentials();
  const url = (input.url ?? stored?.url ?? '').trim();
  const bindDn = (input.bindDn ?? stored?.bindDn ?? '').trim();
  const bindPassword = input.bindPassword || stored?.bindPassword || '';

  if (!url || !bindDn) {
    return { ok: false, error: 'Faltan url o bindDn para probar la conexión' };
  }

  const client = new LdapClient({ url, timeout: 10_000, connectTimeout: 10_000 });
  try {
    await client.bind(bindDn, bindPassword);
    return { ok: true, message: `Bind correcto contra ${url}` };
  } catch (err) {
    return { ok: false, error: err.message ?? 'Fallo en el bind LDAP' };
  } finally {
    await client.unbind().catch(() => {});
  }
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
