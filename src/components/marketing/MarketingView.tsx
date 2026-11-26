import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProblem } from '@/components/FormProblem';
import { formatCurrency } from '@/lib/format';
import {
  createPost, deletePost, fetchCandidates, fetchPosts, publishPost, reviewPost, statusLabels, updatePost,
  type Candidate, type MarketingPost,
} from '@/lib/marketing';
import { buildPostCopy, buildStoryCopy, quickReplies } from '@/lib/marketingCopy';
import { drawPiece } from '@/lib/marketingPiece';
import '@/components/marketing/marketing.css';

type Tab = 'crear' | 'piezas';

export function MarketingView({ canApprove }: { canApprove: boolean }) {
  const [tab, setTab] = useState<Tab>('piezas');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([fetchCandidates(), fetchPosts()]);
    setCandidates(c.data);
    setPosts(p.data);
    setError(c.error ?? p.error);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, action: () => Promise<string | null>): Promise<boolean> => {
    setBusy(key);
    const problem = await action();
    setBusy(null);
    setError(problem);
    if (!problem) await load();
    return !problem;
  };

  const generate = async (c: Candidate): Promise<void> => {
    if (c.promo_price_cop === null) return;
    const input = { product: c.product_name, price: c.price_cop, promo: c.promo_price_cop, validTo: c.valid_to };
    const post = buildPostCopy(input);
    const story = buildStoryCopy(input);
    const ok = await act(c.product_id + c.promotion_id, async () =>
      (await createPost('post', c, post.headline, post.caption)) ?? (await createPost('story', c, story.headline, story.caption)));
    if (ok) setTab('piezas');
  };

  const pending = posts.filter((p: MarketingPost) => p.status === 'draft').length;

  return (
    <section className="mkt-view">
      <header className="mkt-head">
        <h2>Marketing</h2>
        <p className="muted">Las promociones activas se convierten en posts y stories. Nada se publica sin aprobación del propietario o del gerente.</p>
      </header>
      <div className="mkt-tabs">
        <button type="button" className={`chip ${tab === 'piezas' ? 'active' : ''}`} onClick={() => setTab('piezas')}>Piezas{pending > 0 ? ` (${pending} por aprobar)` : ''}</button>
        <button type="button" className={`chip ${tab === 'crear' ? 'active' : ''}`} onClick={() => setTab('crear')}>Crear desde promociones</button>
      </div>
      {error && <FormProblem message={error} />}

      {tab === 'crear' && (
        <div className="mkt-list">
          {candidates.length === 0 && <p className="muted">No hay promociones activas con platos para promocionar. Actívalas en Inventario &gt; Asistente.</p>}
          {candidates.map((c: Candidate) => (
            <article key={c.promotion_id + c.product_id} className="mkt-card">
              <div>
                <strong>{c.product_name}</strong>
                <p className="muted">Mueve: {c.item_name} · hasta {c.valid_to}</p>
                {c.promo_price_cop === null
                  ? <p className="mkt-warn">{c.note}</p>
                  : <p>Antes {formatCurrency(c.price_cop)} → <strong>{formatCurrency(c.promo_price_cop)}</strong> <small className="muted">(−{formatCurrency(c.discount_cop ?? 0)})</small></p>}
              </div>
              <button type="button" className="primary-button" disabled={c.promo_price_cop === null || c.has_open_post || busy === c.product_id + c.promotion_id} onClick={() => void generate(c)}>
                {c.has_open_post ? 'Ya tiene piezas' : 'Crear post y story'}
              </button>
            </article>
          ))}
        </div>
      )}

      {tab === 'piezas' && (
        <div className="mkt-list">
          {posts.length === 0 && <p className="muted">Todavía no hay piezas. Créalas en la pestaña “Crear desde promociones”.</p>}
          {posts.map((p: MarketingPost) => (
            <PostCard key={p.id} post={p} canApprove={canApprove} busy={busy === p.id} onAct={(action: () => Promise<string | null>) => act(p.id, action)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PostCard({ post, canApprove, busy, onAct }: { post: MarketingPost; canApprove: boolean; busy: boolean; onAct: (action: () => Promise<string | null>) => Promise<boolean> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [headline, setHeadline] = useState(post.headline);
  const [caption, setCaption] = useState(post.caption);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const edited = headline !== post.headline || caption !== post.caption;

  useEffect(() => {
    if (canvasRef.current) drawPiece(canvasRef.current, { kind: post.kind, headline, product: post.product_name, price: post.price_original_cop, promo: post.price_promo_cop, validTo: post.valid_to, photo });
  }, [post, headline, photo]);

  const onPhoto = (file: File | undefined): void => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setPhoto(img); URL.revokeObjectURL(url); };
    img.src = url;
  };

  const download = (): void => {
    canvasRef.current?.toBlob((blob: Blob | null) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${post.kind}-${post.product_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    }, 'image/png');
  };

  const copy = async (label: string, text: string): Promise<void> => {
    try { await navigator.clipboard.writeText(text); setCopied(label); } catch { setCopied(null); }
  };

  const replies = quickReplies({ product: post.product_name, price: post.price_original_cop, promo: post.price_promo_cop, validTo: post.valid_to });
  const locked = post.status === 'published';

  return (
    <article className={`mkt-post ${post.status}`}>
      <div className="mkt-preview"><canvas ref={canvasRef} className={post.kind} /></div>
      <div className="mkt-body">
        <header>
          <strong>{post.kind === 'story' ? 'Story' : 'Post'} · {post.product_name}</strong>
          <span className={`mkt-status ${post.status}`}>{statusLabels[post.status]}</span>
        </header>
        <p className="muted">{formatCurrency(post.price_original_cop)} → {formatCurrency(post.price_promo_cop)} · hasta {post.valid_to}</p>
        {post.status === 'rejected' && post.rejection_reason && <p className="mkt-warn">Rechazada: {post.rejection_reason}</p>}
        <label>Título de la pieza<input value={headline} disabled={locked} onChange={(e) => setHeadline(e.target.value)} /></label>
        <label>Texto para Facebook / Instagram<textarea rows={6} value={caption} disabled={locked} onChange={(e) => setCaption(e.target.value)} /></label>
        {!locked && <label className="mkt-photo">Foto del plato (opcional)<input type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} /></label>}
        <div className="mkt-actions">
          {edited && !locked && <button type="button" className="secondary-button" disabled={busy} onClick={() => void onAct(() => updatePost(post.id, headline, caption))}>Guardar cambios (vuelve a aprobación)</button>}
          {canApprove && post.status !== 'published' && !edited && (
            <>
              {post.status !== 'approved' && <button type="button" className="primary-button" disabled={busy} onClick={() => void onAct(() => reviewPost(post.id, true))}>Aprobar</button>}
              {!rejecting && post.status !== 'rejected' && <button type="button" className="secondary-button" disabled={busy} onClick={() => setRejecting(true)}>Rechazar</button>}
            </>
          )}
          {post.status === 'approved' && (
            <>
              <button type="button" className="secondary-button" onClick={download}>Descargar imagen</button>
              <button type="button" className="secondary-button" onClick={() => void copy('texto', caption)}>{copied === 'texto' ? 'Texto copiado' : 'Copiar texto'}</button>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void onAct(() => publishPost(post.id))}>Ya la publiqué</button>
            </>
          )}
          {(post.status === 'draft' || post.status === 'rejected') && <button type="button" className="secondary-button" disabled={busy} onClick={() => void onAct(() => deletePost(post.id))}>Borrar</button>}
        </div>
        {post.status === 'draft' && !canApprove && <p className="muted">Está esperando la aprobación del propietario o del gerente.</p>}
        {rejecting && (
          <div className="mkt-reject">
            <input placeholder="¿Por qué se rechaza?" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="secondary-button" disabled={busy || !reason.trim()} onClick={() => void onAct(() => reviewPost(post.id, false, reason)).then((ok: boolean) => { if (ok) setRejecting(false); })}>Confirmar rechazo</button>
          </div>
        )}
        {post.kind === 'post' && (
          <details className="mkt-replies">
            <summary>Respuestas rápidas para comentarios</summary>
            {replies.map((r) => (
              <div key={r.question}>
                <small className="muted">{r.question}</small>
                <p>{r.answer} <button type="button" className="link-button" onClick={() => void copy(r.question, r.answer)}>{copied === r.question ? 'Copiado' : 'Copiar'}</button></p>
              </div>
            ))}
          </details>
        )}
      </div>
    </article>
  );
}
