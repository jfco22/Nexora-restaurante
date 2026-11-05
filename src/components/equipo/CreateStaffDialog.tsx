import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { roleLabels } from '@/lib/staffRoles';

type CreateStaffDialogProps = { callerRole: string; onClose: () => void; onCreated: () => void };

const CREATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-user`;

export function CreateStaffDialog({ callerRole, onClose, onCreated }: CreateStaffDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('waiter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onClose]);

  const roleOptions = Object.entries(roleLabels).filter(([value]: [string, string]) => value !== 'owner' || callerRole === 'owner');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('no session');

      const response = await fetch(CREATE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, display_name: displayName, role }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'No pudimos crear el usuario. Inténtalo de nuevo.';
        setError(message);
        return;
      }
      onCreated();
    } catch {
      setError('No pudimos conectar con el servidor. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="team-dialog-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section className="team-dialog" role="dialog" aria-modal="true" aria-labelledby="create-staff-title" onClick={(event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <div className="team-dialog-heading">
          <div>
            <p className="eyebrow">Equipo</p>
            <h2 id="create-staff-title">Nuevo usuario</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>
        <form className="team-form" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void handleSubmit(event)}>
          <label>Nombre<input value={displayName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} placeholder="Nombre de la persona" required maxLength={80} /></label>
          <label>Correo electrónico<input type="email" value={email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} placeholder="correo@restaurante.com" required /></label>
          <label>Contraseña inicial<input type="password" minLength={6} maxLength={72} value={password} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} placeholder="Mínimo 6 caracteres" required /></label>
          <label>Rol<select value={role} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setRole(event.target.value)}>{roleOptions.map(([value, label]: [string, string]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {error && <p className="auth-feedback error" role="alert">{error}</p>}
          <div className="team-dialog-actions">
            <button className="outline-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creando...' : 'Crear usuario'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
