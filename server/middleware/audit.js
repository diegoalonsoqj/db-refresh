// Middleware de auditoría de mutaciones: registra toda petición que cambia estado
// (POST/PUT/PATCH/DELETE) tras responder, con actor (req.user), ip, ruta y status.
// El login/logout/methods se auditan explícitamente en el controlador (necesitan
// email/outcome y el actor aún no está resuelto), así que se saltan aquí.
import { audit } from '../lib/audit.js';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP = [/\/auth\/(login|logout|methods)$/];

export function auditMutations(req, res, next) {
  if (!MUTATIONS.has(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  if (SKIP.some((re) => re.test(path))) return next();

  res.on('finish', () => {
    audit({
      req,
      action: `${req.method} ${path}`,
      entity: path.split('/')[2] ?? null, // /api/<entity>/...
      metadata: { status: res.statusCode },
    });
  });
  next();
}
