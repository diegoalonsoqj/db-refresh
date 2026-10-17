/**
 * Convierte una imagen en un data URL cuadrado y pequeño (recortado al centro),
 * apto para la foto de perfil: así pesa pocos KB en la BD (como db-keeper).
 */
export async function fileToAvatarDataUrl(file, size = 96) {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Iniciales para el avatar sin foto. */
export function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Nombre visible de un usuario. */
export const displayName = (u) => u?.full_name || u?.email || u?.username || '';
