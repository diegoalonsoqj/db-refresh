// Reglas sobre la fila de gcp_instances que comparten catálogo, post-scripts y adaptadores.
//
// El restore (drop + import + polling) va por el Cloud SQL Admin API con la service
// account de Ajustes: NO necesita credenciales SQL. Host, usuario admin y secret_ref
// solo hacen falta para los post-scripts (conexión SQL real a la instancia).

export const SQL_CREDENTIAL_FIELDS = ['db_host', 'admin_user', 'secret_ref'];

/** Campos de conexión SQL que le faltan a la instancia ([] = completa). */
export function missingSqlCredentials(instance) {
  return SQL_CREDENTIAL_FIELDS.filter((f) => !instance?.[f]);
}
