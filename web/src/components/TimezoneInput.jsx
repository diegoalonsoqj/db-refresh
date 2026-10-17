import { useId } from 'react';

// Zonas IANA del navegador (Intl); si no las expone, basta con escribirla a mano.
const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

/** Campo de zona horaria con sugerencias (p.ej. America/Lima). La valida la API. */
export default function TimezoneInput({ value, onChange, ...props }) {
  const listId = useId();
  return (
    <>
      <input className="mono" list={listId} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="America/Lima" spellCheck={false} autoComplete="off" {...props} />
      <datalist id={listId}>
        {ZONES.map((z) => <option key={z} value={z} />)}
      </datalist>
    </>
  );
}
