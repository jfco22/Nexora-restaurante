import { useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ForgotPasswordScreenProps = { onBack: () => void };

export function ForgotPasswordScreen({ onBack }: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });

    setBusy(false);

    if (resetError) {
      setError('No pudimos enviar el correo. Revisa la dirección e inténtalo de nuevo.');
      return;
    }

    setSent(true);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span className="brand-mark">N</span><strong>Nexora</strong></div>
        <p className="eyebrow">Recuperar acceso</p>
        <h1>¿Olvidaste tu contraseña?</h1>
        <p className="auth-description">Te enviaremos un enlace al correo registrado para que elijas una nueva contraseña.</p>

        {sent ? (
          <div className="auth-feedback success" role="status">
            Si el correo está registrado, recibirás un enlace para restablecer tu contraseña en unos minutos. Revisa tu bandeja y la carpeta de spam.
          </div>
        ) : (
          <form onSubmit={(event: React.FormEvent<HTMLFormElement>) => void handleSubmit(event)}>
            <label>Correo electrónico
              <input type="email" value={email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} placeholder="tu@restaurante.com" required />
            </label>
            {error && <p className="auth-feedback error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              <Mail size={16} />{busy ? 'Enviando...' : 'Enviar enlace'}
            </button>
          </form>
        )}

        <button className="auth-switch" type="button" onClick={onBack}><ArrowLeft size={15} /> Volver al inicio de sesión</button>
      </section>
    </main>
  );
}
