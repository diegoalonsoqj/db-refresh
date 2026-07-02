import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';

// Gestiona la relación N:N instancia <-> buckets: vincular, marcar default, desvincular.
export default function LinkBucketsModal({ instance, allBuckets, onClose }) {
  const [linked, setLinked] = useState(null);
  const [toAdd, setToAdd] = useState('');
  const [asDefault, setAsDefault] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/instances/${instance.id}/buckets`).then(setLinked).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const linkedIds = new Set((linked ?? []).map((b) => b.id));
  const available = allBuckets.filter((b) => !linkedIds.has(b.id));

  const link = async (bucketId, isDefault) => {
    setBusy(true); setErr(null);
    try { await api.post(`/instances/${instance.id}/buckets`, { bucketId, isDefault }); await load(); setToAdd(''); setAsDefault(false); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const unlink = async (bucketId) => {
    setBusy(true); setErr(null);
    try { await api.del(`/instances/${instance.id}/buckets/${bucketId}`); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal wide title={`Buckets de ${instance.instance_name}`} onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      {!linked ? <div className="muted">Cargando…</div> : (
        <>
          <table className="table">
            <thead><tr><th>Bucket</th><th>Default</th><th /></tr></thead>
            <tbody>
              {linked.length === 0 && <tr><td colSpan="3" className="muted">Sin buckets vinculados.</td></tr>}
              {linked.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.bucket_name}<span className="mono small muted"> {b.base_prefix}</span></td>
                  <td>
                    {b.is_default
                      ? <span className="pill on">default</span>
                      : <button className="btn ghost small" disabled={busy} onClick={() => link(b.id, true)}>hacer default</button>}
                  </td>
                  <td><button className="btn ghost small" disabled={busy} onClick={() => unlink(b.id)}>Desvincular</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Vincular bucket</h3>
          <div className="row gap">
            <select value={toAdd} onChange={(e) => setToAdd(e.target.value)} disabled={!available.length} style={{ flex: 1 }}>
              <option value="">{available.length ? '— elegir —' : '(no hay buckets disponibles)'}</option>
              {available.map((b) => <option key={b.id} value={b.id}>{b.bucket_name} · {b.project_id}</option>)}
            </select>
            <label className="checkline"><input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} /> default</label>
            <button className="btn primary" disabled={!toAdd || busy} onClick={() => link(toAdd, asDefault)}>Vincular</button>
          </div>
        </>
      )}
    </Modal>
  );
}
