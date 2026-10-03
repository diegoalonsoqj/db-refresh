// Ajustes HTTP que dependen de si la app se sirve por HTTPS o por HTTP plano
// (primera etapa: acceso por IP:puerto sin dominio). Funciones puras, testeables.

// TRUST_PROXY -> valor de `app.set('trust proxy', ...)`.
// Sin proxy delante debe ser false: si no, el cliente controla X-Forwarded-For,
// falsea req.ip y se salta el rate-limit de login (y ensucia audit_log.ip).
export function parseTrustProxy(raw, fallback = 1) {
  if (raw === undefined || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
  return String(raw).trim(); // IPs/subredes o 'loopback'
}

// Opciones de helmet. Sobre HTTP plano se quitan solo las piezas que exigen TLS:
// - upgrade-insecure-requests: el navegador pediría /assets/*.js por https -> pantalla en blanco.
// - HSTS: se ignora sobre http y, si algún día hay TLS en esa IP, fijaría https a ciegas.
// - COOP: el navegador lo ignora en orígenes no confiables (solo genera avisos).
// El resto de la CSP (default-src 'self', etc.) se mantiene igual.
export function helmetOptions({ https }) {
  if (https) return {};
  return {
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
    crossOriginOpenerPolicy: false,
  };
}
