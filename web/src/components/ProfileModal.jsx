import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fileToAvatarDataUrl } from '../lib/avatar.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { roleLabel } from '../lib/roles.js';

/**
 * «Mi perfil» (como db-keeper): foto, nombre y email del propio usuario y, si es
 * local, el cambio de contraseña. Los de AD cambian la contraseña en el directorio.
 */
export default function ProfileModal({ onClose }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const isAd = user.auth_source === 'ad';

  const [fullName, setFullName] = useState(user.full_name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [avatar, setAvatar] = useState(user.avatar ?? null);
  const [profileErr, setProfileErr] = useState(null);

  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [pwdErr, setPwdErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async (file) => {
    setProfileErr(null);
    try { setAvatar(await fileToAvatarDataUrl(file)); }
    catch (e) { setProfileErr(e.message); }
  };

  const saveProfile = async (e) => {
    e.preventDefault(); setBusy(true); setProfileErr(null);
    try {
      await api.patch('/auth/profile', { fullName, email: email || null, avatar: avatar ?? null });
      await refresh();
      toast.success('Perfil guardado');
    } catch (err) { setProfileErr(err.message); }
    finally { setBusy(false); }
  };

  const savePassword = async (e) => {
    e.preventDefault(); setPwdErr(null);
    if (newPassword !== confirmPassword) { setPwdErr('La confirmación no coincide con la nueva contraseña'); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrent(''); setNew(''); setConfirm('');
      toast.success('Contraseña actualizada');
    } catch (err) { setPwdErr(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Mi perfil" onClose={onClose} size="md">
      <form className="stack" onSubmit={saveProfile}>
        <div className="profile-avatar-row">
          <Avatar user={user} src={avatar} size="lg" />
          <div className="profile-avatar-actions">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => { if (e.target.files?.[0]) pickFile(e.target.files[0]); e.target.value = ''; }} />
            <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Cambiar foto</button>
            {avatar && <button type="button" className="btn small" onClick={() => setAvatar(null)}>Quitar foto</button>}
            <span className="muted small">{(user.roles ?? []).map(roleLabel).join(' · ') || 'Sin rol'} · {isAd ? 'Active Directory' : 'Local'}</span>
          </div>
        </div>
        <div className="form-grid">
          {isAd && <label>Usuario de red<input className="mono" value={user.username} disabled /></label>}
          <label className={isAd ? '' : 'full'}>Nombre<input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} /></label>
          <label className="full">{isAd ? 'Email (opcional)' : 'Email'}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={!isAd} />
            {!isAd && <span className="field-hint">Es tu usuario para entrar: si lo cambias, inicias sesión con el nuevo.</span>}
          </label>
          {profileErr && <div className="alert error full">{profileErr}</div>}
        </div>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={busy}>Guardar perfil</button>
        </div>
      </form>

      <hr className="sep" />
      {isAd ? (
        <p className="muted small">Tu contraseña es la de la red: se cambia en el directorio (Active Directory).</p>
      ) : (
        <form className="stack" onSubmit={savePassword}>
          <h3 className="profile-subtitle">Cambiar contraseña</h3>
          <div className="form-grid">
            <label className="full">Contraseña actual
              <input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </label>
            <label>Nueva contraseña
              <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" minLength={10} required />
              <span className="field-hint">Mínimo 10 caracteres.</span>
            </label>
            <label>Confirmar
              <input type="password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
            {pwdErr && <div className="alert error full">{pwdErr}</div>}
          </div>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={busy}>Cambiar contraseña</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
