import { useState } from 'react';
import { FormProblem } from '@/components/FormProblem';
import { connectMeta, disconnectMeta, type MetaPage, type MetaStatus } from '@/lib/meta';

export function MetaConnection({ status, canManage, onChanged }: { status: MetaStatus | null; canManage: boolean; onChanged: () => void }) {
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [userToken, setUserToken] = useState('');
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (pageId?: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const reply = await connectMeta(appId.trim(), secret.trim(), userToken.trim(), pageId);
    setBusy(false);
    if (reply.error) { setError(reply.error); return; }
    if (reply.data?.needs_choice) { setPages(reply.data.pages ?? []); return; }
    setPages(null); setSecret(''); setUserToken('');
    onChanged();
  };

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('¿Desconectar Facebook e Instagram? Las piezas dejarán de poder publicarse con un clic.')) return;
    setBusy(true);
    const reply = await disconnectMeta();
    setBusy(false);
    if (reply.error) setError(reply.error); else onChanged();
  };

  return (
    <div className="mkt-conn">
      {status?.connected ? (
        <div className="mkt-publish">
          <p><strong>{status.healthy === false ? '⚠ Conectado, pero el permiso falló' : '✓ Conectado con Meta'}</strong></p>
          <p>Página de Facebook: <strong>{status.page_name}</strong></p>
          <p>Instagram: {status.has_instagram ? <strong>@{status.ig_username}</strong> : <span className="mkt-warn">esta página no tiene un Instagram de empresa vinculado</span>}</p>
          {status.healthy === false && <p className="mkt-warn">{status.problem}</p>}
          {canManage && <button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect()}>Desconectar</button>}
        </div>
      ) : <p className="muted">Todavía no hay conexión con Meta.</p>}
      {error && <FormProblem message={error} />}

      {canManage && (
        <>
          <h3>{status?.connected ? 'Volver a conectar' : 'Conectar Facebook e Instagram'}</h3>
          <ol>
            <li>Entra a <strong>developers.facebook.com</strong> con tu Facebook, toca <em>Mis apps → Crear app</em>, elige el tipo <em>Empresa</em> y ponle de nombre “El Taita”. Déjala en modo <em>Desarrollo</em>: no necesitas pedir revisión de Meta para publicar en tus propias cuentas.</li>
            <li>En <em>Configuración → Básica</em> copia el <strong>ID de la app</strong> y la <strong>Clave secreta</strong> (botón Mostrar).</li>
            <li>Abre <strong>Herramientas → Explorador de la API Graph</strong>, elige tu app y, en <em>Permisos</em>, agrega: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code>, <code>instagram_content_publish</code> y <code>business_management</code>.</li>
            <li>Toca <em>Generate Access Token</em>, acepta marcando tu página de Facebook y tu cuenta de Instagram, y copia el token que aparece.</li>
            <li>Pega los tres datos aquí abajo. El token y la clave solo se usan una vez para obtener un permiso de la página; la clave no se guarda.</li>
          </ol>
          <label>ID de la app<input value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" /></label>
          <label>Clave secreta de la app<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label>
          <label>Token del Explorador de la API Graph<input type="password" value={userToken} onChange={(e) => setUserToken(e.target.value)} autoComplete="off" /></label>
          {pages ? (
            <div>
              <p>Tienes varias páginas. ¿Cuál es la del restaurante?</p>
              <div className="mkt-pages">
                {pages.map((p: MetaPage) => <button key={p.id} type="button" className="secondary-button" disabled={busy} onClick={() => void connect(p.id)}>{p.name}{p.has_instagram ? ' (con Instagram)' : ''}</button>)}
              </div>
            </div>
          ) : (
            <button type="button" className="primary-button" disabled={busy || !appId.trim() || !secret.trim() || !userToken.trim()} onClick={() => void connect()}>{busy ? 'Conectando…' : 'Conectar'}</button>
          )}
          <p className="muted">Requisito: el Instagram del restaurante debe ser una cuenta <em>profesional</em> (empresa o creador) y estar vinculado a la página de Facebook (en Instagram: Configuración → Cuenta → Cuentas vinculadas).</p>
        </>
      )}
      {!canManage && <p className="muted">Solo el propietario o el gerente puede conectar o desconectar Meta.</p>}
    </div>
  );
}
