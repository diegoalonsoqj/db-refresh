// Resuelve la conexión SQL de una instancia del catálogo: host/puerto de la
// instancia (IP privada) + usuario/contraseña de su credencial. La contraseña
// se descifra (o se lee de Secret Manager / env) solo en el momento de conectar
// y nunca se loguea.
import * as credentialsRepo from '../../data/repositories/credentials.repo.js';
import { DomainError, InfraError, NotFoundError } from '../../domain/errors.js';
import { DEFAULT_PORTS } from '../../domain/credential.js';
import { missingSqlCredentials } from '../../domain/instance.js';
import { decrypt } from '../../lib/crypto.js';
import { resolveSecret } from '../../lib/secrets.js';

/** Contraseña en claro de una credencial (fila de getSecretById). */
export async function credentialPassword(cred) {
  if (cred.secret_kind === 'ref') return resolveSecret(cred.secret_ref);
  try {
    return decrypt(cred.password_enc);
  } catch (err) {
    throw new InfraError(
      `No se pudo descifrar la contraseña de la credencial "${cred.name}" (¿cambió APP_ENCRYPTION_KEY?)`,
      { code: 'CREDENTIAL_DECRYPT_FAILED', cause: err },
    );
  }
}

/**
 * Conexión a partir de host/puerto y una credencial (alta de instancia, prueba).
 * @returns { engine, host, port, user, password, label }
 */
export async function connectionFor({ engine, host, port, credentialId }) {
  const cred = await credentialsRepo.getSecretById(credentialId);
  if (!cred) throw new NotFoundError(`Credencial ${credentialId} no encontrada`);
  if (engine && cred.engine !== engine) {
    throw new DomainError(`La credencial "${cred.name}" es de ${cred.engine}, no de ${engine}`, {
      code: 'CREDENTIAL_ENGINE_MISMATCH',
    });
  }
  const finalPort = port || DEFAULT_PORTS[cred.engine];
  return {
    engine: cred.engine,
    host,
    port: finalPort,
    user: cred.username,
    password: await credentialPassword(cred),
    label: `${cred.username}@${host}:${finalPort}`,
  };
}

/** Conexión SQL de una instancia del catálogo. Lanza si no la tiene configurada. */
export async function resolveSqlConnection(instance) {
  const missing = missingSqlCredentials(instance);
  if (missing.length) {
    throw new DomainError(
      `La instancia ${instance.instance_name} no tiene conexión SQL (falta: ${missing.join(', ')}). ` +
        'Configúrala en Catálogo → Instancias.',
      { code: 'POST_SCRIPTS_NO_CREDENTIALS' },
    );
  }
  return connectionFor({
    engine: instance.engine,
    host: instance.db_host,
    port: instance.db_port,
    credentialId: instance.credential_ref,
  });
}
