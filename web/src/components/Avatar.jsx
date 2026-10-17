import { displayName, initialsOf } from '../lib/avatar.js';

/** Foto de perfil o, si no hay, las iniciales sobre el color primario. */
export default function Avatar({ user, src, size }) {
  const img = src !== undefined ? src : user?.avatar;
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`}>
      {img ? <img src={img} alt="" /> : initialsOf(displayName(user))}
    </span>
  );
}
