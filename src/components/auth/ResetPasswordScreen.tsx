import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export const MIN_PASSWORD_LENGTH = 8;

/** Cambia la contraseña de la sesión actual. Sirve para el enlace del correo y para "Cambiar contraseña" del perfil. */
export function PasswordForm({ onDone, submitLabel = 'Guardar contraseña' }: { onDone: () => void; submitLabel?: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`); return; }
    if (password !== confirm) { setError('Las dos contraseñas no coinciden.'); return; }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      const code = (updateError as { code?: string }).code;
      setError(code === 'same_password' ? 'La nueva contraseña debe ser distinta a la anterior.'
        : code === 'weak_password' ? 'Esa contraseña es muy fácil de adivinar. Usa letras, números y algún símbolo.'
        : 'No pudimos cambiar la contraseña. Pide un enlace nuevo e inténtalo de nuevo.');
      return;
    }
    setPassword(''); setConfirm('');
    onDone();
  };

  return (
    <form onSubmit={(event: React.FormEvent<HTMLFormElement>) => void submit(event)}>
      <label>Nueva contraseña
        <input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
      </label>
      <label>Repite la nueva contraseña
        <input type="password" value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </label>
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}><KeyRound size={16} />{busy ? 'Guardando...' : submitLabel}</button>
    </form>
  );
}

export function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span className="brand-mark">N</span><strong>Nexora</strong></div>
        <p className="eyebrow">Recuperar acceso</p>
        <h1>Elige tu nueva contraseña</h1>
        <p className="auth-description">Escribe una contraseña nueva de al menos {MIN_PASSWORD_LENGTH} caracteres. Después entrarás directo a la app.</p>
        <PasswordForm onDone={onDone} />
      </section>
    </main>
  );
}
