// Reglas de las credenciales SQL (funciones puras, sin BD ni red).
import { ValidationError } from './errors.js';
import { parseSecretRef } from '../lib/secrets.js';

export const ENGINES = ['sqlserver', 'postgres', 'mysql'];
export const SECRET_KINDS = ['stored', 'ref']; // contraseña cifrada en la app | referencia (sm:// / env:)

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Valida y normaliza el alta/edición de una credencial.
 * @param input    body recibido
 * @param existing fila actual (edición) o null (alta). En edición la contraseña
 *                 es opcional: vacía = conservar la guardada.
 * @returns { name, engine, username, description, secretKind, password|null, secretRef|null }
 */
export function validateCredentialInput(input = {}, existing = null) {
  const name = text(input.name);
  if (!name) throw new ValidationError('name es obligatorio');
  if (name.length > 100) throw new ValidationError('name admite como máximo 100 caracteres');

  const engine = input.engine;
  if (!ENGINES.includes(engine)) throw new ValidationError(`engine inválido: ${engine}`);

  const username = text(input.username);
  if (!username) throw new ValidationError('username es obligatorio');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(username)) throw new ValidationError('username contiene caracteres no válidos');

  const secretKind = input.secretKind ?? existing?.secret_kind ?? 'stored';
  if (!SECRET_KINDS.includes(secretKind)) throw new ValidationError(`secretKind inválido: ${secretKind}`);

  let password = null;
  let secretRef = null;
  if (secretKind === 'stored') {
    password = typeof input.password === 'string' && input.password !== '' ? input.password : null;
    // Obligatoria al crear o al pasar de referencia a contraseña guardada.
    const keepsStored = existing?.secret_kind === 'stored' && existing?.has_password;
    if (!password && !keepsStored) throw new ValidationError('password es obligatoria');
  } else {
    secretRef = text(input.secretRef);
    if (!secretRef) throw new ValidationError('secretRef es obligatorio');
    parseSecretRef(secretRef); // formato sm://projects/<p>/secrets/<s>[/versions/<v>] | env:NOMBRE
  }

  return {
    name,
    engine,
    username,
    description: text(input.description) || null,
    secretKind,
    password,
    secretRef,
  };
}

/** Puerto por defecto de cada motor. */
export const DEFAULT_PORTS = { sqlserver: 1433, postgres: 5432, mysql: 3306 };
