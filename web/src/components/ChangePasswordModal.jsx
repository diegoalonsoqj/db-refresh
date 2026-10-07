import { useState } from 'react';
import { api } from '../api/client.js';
import { FormModal } from './ui.jsx';
import { useToast } from './Toast.jsx';

export default function ChangePasswordModal({ onClose }) {
  const toast = useToast();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Contraseña actualizada');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <FormModal title="Cambiar contraseña" size="sm" onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <label className="full">Contraseña actual
        <input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required />
      </label>
      <label className="full">Nueva contraseña
        <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" required />
        <span className="field-hint">Mínimo 10 caracteres.</span>
      </label>
    </FormModal>
  );
}
