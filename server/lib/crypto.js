// Cifrado simétrico at-rest para settings sensibles (password de bind AD,
// JSON de la service account de GCP). AES-256-GCM (autenticado).
//
// La master key vive en APP_ENCRYPTION_KEY (env / Secret Manager), NUNCA en la BD.
// En la BD solo queda el blob cifrado: [ iv(12) | authTag(16) | ciphertext ].
// La clave de 32 bytes se deriva de la passphrase con scrypt (salt fija) para
// aceptar cualquier longitud de APP_ENCRYPTION_KEY de forma determinista.
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config/index.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let keyCache = null;

function getKey() {
  if (keyCache) return keyCache;
  const secret = config.encryptionKey;
  if (!secret) {
    throw new Error(
      'APP_ENCRYPTION_KEY no configurada: es obligatoria para guardar/leer settings cifrados',
    );
  }
  keyCache = scryptSync(secret, 'db-refresh:settings:v1', 32);
  return keyCache;
}

/** Cifra texto plano. Devuelve un Buffer listo para columna bytea. */
export function encrypt(plaintext) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/** Descifra un blob generado por encrypt(). Lanza si la master key no coincide. */
export function decrypt(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
