// Estado compartido para invalidar las credenciales GCP cacheadas cuando se
// actualiza la service account por el módulo de settings. Sin imports para no
// crear ciclos entre settings.service y los clientes GCP (storage/cloudsql).
let epoch = 0;

/** Número de versión actual de las credenciales GCP. */
export function currentEpoch() {
  return epoch;
}

/** Invalida los clientes GCP cacheados (se reconstruyen en la próxima llamada). */
export function invalidateGcp() {
  epoch += 1;
}
