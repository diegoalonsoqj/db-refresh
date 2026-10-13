// Cadena de conexión de MongoDB (la que entrega Atlas o la de un servidor propio) ->
// campos de la instancia. La contraseña de la cadena se descarta: va en Credenciales.
// El servidor vuelve a validar host y opciones (domain/mongo.js). Sin JSX ni dependencias.

/** "a=1&b=2" <-> { a: '1', b: '2' } */
export const optionsToText = (options) => Object.entries(options ?? {}).map(([k, v]) => `${k}=${v}`).join('&');

/**
 * -> { srv, host, port, username, options (texto) } o lanza Error si no es una cadena mongodb.
 */
export function parseConnectionString(raw) {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/i.exec(String(raw ?? '').trim());
  if (!m) throw new Error('La cadena debe empezar con mongodb:// o mongodb+srv://');
  const [, scheme, userInfo, hostPart, query] = m;
  const srv = scheme.toLowerCase() === 'mongodb+srv';
  let username = null;
  if (userInfo) {
    const user = decodeURIComponent(userInfo.split(':')[0]);
    username = user && !/^<.*>$/.test(user) ? user : null; // <db_username> de Atlas no es un usuario
  }
  let host = hostPart;
  let port = '';
  if (!srv && !host.includes(',')) {
    const hp = /^(.+):(\d{1,5})$/.exec(host);
    if (hp) { host = hp[1]; port = hp[2]; }
  }
  return { srv, host, port, username, options: query ? decodeURIComponent(query) : '' };
}
