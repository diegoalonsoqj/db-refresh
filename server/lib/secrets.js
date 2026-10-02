// Resolución de `secret_ref` del catálogo de instancias. El catálogo guarda una
// REFERENCIA al password del usuario admin de la instancia, nunca el valor:
//   sm://projects/<p>/secrets/<s>[/versions/<v>]  -> Secret Manager (versión latest por defecto)
//   env:NOMBRE                                     -> variable de entorno (dev)
import { GoogleAuth } from 'google-auth-library';
import { DomainError, InfraError } from '../domain/errors.js';
import { getSaCredentials } from '../services/settings.service.js';

const SM_RE = /^sm:\/\/(projects\/[^/]+\/secrets\/[^/]+)(?:\/versions\/([^/]+))?$/;
const ENV_RE = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * Parsea una referencia sin resolverla (función pura).
 * @returns {{ kind: 'sm', name: string } | { kind: 'env', name: string }}
 */
export function parseSecretRef(ref) {
  const value = typeof ref === 'string' ? ref.trim() : '';
  const sm = SM_RE.exec(value);
  if (sm) return { kind: 'sm', name: `${sm[1]}/versions/${sm[2] ?? 'latest'}` };
  const env = ENV_RE.exec(value);
  if (env) return { kind: 'env', name: env[1] };
  throw new DomainError(
    `secret_ref inválido: use sm://projects/<p>/secrets/<s>[/versions/<v>] o env:NOMBRE`,
    { code: 'BAD_SECRET_REF' },
  );
}

async function accessSecretManager(name) {
  const sa = await getSaCredentials();
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    ...(sa ? { credentials: sa.credentials } : {}),
  });
  try {
    const client = await auth.getClient();
    const { data } = await client.request({
      url: `https://secretmanager.googleapis.com/v1/${name}:access`,
    });
    return Buffer.from(data.payload.data, 'base64').toString('utf8');
  } catch (err) {
    throw new InfraError(`No se pudo leer el secreto ${name} de Secret Manager`, {
      code: 'SECRET_ACCESS_FAILED',
      cause: err,
    });
  }
}

/** Devuelve el valor del secreto. Nunca lo loguea. */
export async function resolveSecret(ref) {
  const parsed = parseSecretRef(ref);
  if (parsed.kind === 'env') {
    const v = process.env[parsed.name];
    if (v === undefined || v === '') {
      throw new DomainError(`La variable de entorno ${parsed.name} (secret_ref) no está definida`, {
        code: 'SECRET_NOT_FOUND',
      });
    }
    return v;
  }
  return accessSecretManager(parsed.name);
}
