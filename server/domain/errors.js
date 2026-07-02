// Errores tipados: dominio (regla de negocio / entrada del usuario, 4xx)
// vs infraestructura (GCP, BD, red, 5xx). Los controladores mapean a HTTP.

export class AppError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** Error de dominio: entrada inválida o violación de regla de negocio. */
export class DomainError extends AppError {
  constructor(message, { code = 'DOMAIN_ERROR', details } = {}) {
    super(message, { code });
    this.status = 400;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(message, opts = {}) {
    super(message, { code: 'NOT_FOUND', ...opts });
    this.status = 404;
  }
}

export class ValidationError extends DomainError {
  constructor(message, details) {
    super(message, { code: 'VALIDATION_ERROR', details });
    this.status = 422;
  }
}

/** Error de autenticación: credenciales inválidas o sesión ausente/expirada. */
export class AuthError extends AppError {
  constructor(message = 'No autenticado', { code = 'UNAUTHENTICATED' } = {}) {
    super(message, { code });
    this.status = 401;
  }
}

/** Error de autorización: autenticado pero sin permiso (rol insuficiente). */
export class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado', { code = 'FORBIDDEN' } = {}) {
    super(message, { code });
    this.status = 403;
  }
}

/** Conflicto de estado: duplicado (unique) o recurso en uso (FK). */
export class ConflictError extends AppError {
  constructor(message = 'Conflicto', { code = 'CONFLICT' } = {}) {
    super(message, { code });
    this.status = 409;
  }
}

/** Error de infraestructura: fallo de un servicio externo (GCP, BD, SQL). */
export class InfraError extends AppError {
  constructor(message, { code = 'INFRA_ERROR', cause } = {}) {
    super(message, { code, cause });
    this.status = 502;
  }
}

export function isAppError(e) {
  return e instanceof AppError;
}
