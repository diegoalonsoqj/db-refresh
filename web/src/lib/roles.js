// Nombre visible de los roles de sistema; un rol personalizado se muestra por su clave.
const ROLE_LABEL = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Solo lectura',
};
export const roleLabel = (key) => ROLE_LABEL[key] ?? key;
