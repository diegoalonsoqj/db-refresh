// Firma y verificación de JWT de sesión. Único punto que conoce el secreto.
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AuthError } from '../domain/errors.js';

/** Firma un token con el payload dado (sub, email, role). */
export function signToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

/** Verifica un token y devuelve su payload. Lanza AuthError si es inválido/expirado. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch (err) {
    throw new AuthError('Sesión inválida o expirada', { code: 'INVALID_TOKEN' });
  }
}
