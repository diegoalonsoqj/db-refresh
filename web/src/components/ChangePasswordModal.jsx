import { useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setMsg({ ok: true, text: 'Contraseña actualizada' });
      setCurrent(''); setNew('');
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Cambiar contraseña" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Contraseña actual<input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>Nueva contraseña (mín. 10)<input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required /></label>
        {msg && <div className={`alert ${msg.ok ? 'warn' : 'error'}`}>{msg.text}</div>}
        <div className="row gap">
          <button className="btn primary" disabled={busy}>Guardar</button>
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </form>
    </Modal>
  );
}
