// Rate limiting. Protege /auth/login de fuerza bruta: cuenta solo los intentos
// FALLIDOS por IP (skipSuccessfulRequests), así un uso legítimo no se bloquea.
import rateLimit from 'express-rate-limit';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 10, // intentos fallidos por IP en la ventana
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos de inicio de sesión; espera unos minutos', code: 'RATE_LIMITED' },
});
