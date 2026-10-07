// Servicio del Panel: agrega indicadores, últimos restores y próximas ejecuciones.
import * as repo from '../data/repositories/dashboard.repo.js';

export async function getDashboard() {
  const d = await repo.getDashboard();
  // % de éxito sobre los terminados (los cancelados no cuentan como éxito ni fallo).
  const finished = d.jobs7d.succeeded + d.jobs7d.failed;
  return {
    ...d,
    jobs7d: { ...d.jobs7d, successRate: finished ? Math.round((d.jobs7d.succeeded / finished) * 100) : null },
  };
}
