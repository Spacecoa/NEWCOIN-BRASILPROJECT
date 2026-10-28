import { useEffect, useRef, useState } from 'react';
import { block, loadReasons, report } from '../lib/moderation.js';

/**
 * Denúncia de um post (postId) ou de uma conta. Na tela final oferece bloquear também:
 * denunciar avisa a moderação, bloquear resolve na hora para quem denunciou.
 */
export default function ReportDialog({ postId, username, onClose, onBlocked }) {
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState('form'); // form | sending | sent
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    loadReasons().then(setReasons).catch((e) => setError(e.message));
    dialog.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(e) {
    e.preventDefault();
    if (!reason) return setError('Escolha um motivo.');
    if (reason === 'outro' && !details.trim()) return setError('Explique o motivo em poucas palavras.');
    setState('sending');
    setError(null);
    try {
      await report(postId ? { post_id: postId, reason, details } : { username, reason, details });
      setState('sent');
    } catch (err) {
      setError(err.message);
      setState('form');
    }
  }

  async function alsoBlock() {
    await block(username);
    setBlocked(true);
    onBlocked?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] outline-none md:rounded-3xl dark:bg-zinc-950"
      >
        {state !== 'sent' ? (
          <form onSubmit={send} className="space-y-4">
            <div>
              <h2 id="report-title" className="text-lg font-extrabold">{postId ? 'Denunciar post' : `Denunciar @${username}`}</h2>
              <p className="text-sm text-zinc-500">
                A moderação desta instância vai analisar com base nas{' '}
                <a href="/regras" target="_blank" rel="noreferrer" className="text-brand-600 underline">regras</a>. @{username} não fica sabendo quem denunciou.
              </p>
            </div>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-semibold">Qual é o problema?</legend>
              {reasons.map((r) => (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="h-5 w-5 accent-brand-600" />
                  <span>{r.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Detalhes {reason === 'outro' ? '' : '(opcional)'}</span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full rounded-2xl bg-zinc-50 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
              />
            </label>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={state === 'sending'} className="min-h-12 flex-1 rounded-full bg-brand-600 font-extrabold text-white disabled:opacity-50">
                Enviar denúncia
              </button>
              <button type="button" onClick={onClose} className="min-h-12 rounded-full px-5 text-zinc-600 dark:text-zinc-300">
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4" role="status">
            <h2 id="report-title" className="text-lg font-extrabold">Denúncia enviada</h2>
            <p className="text-zinc-600 dark:text-zinc-300">
              Obrigado. A moderação vai analisar e você acompanha o resultado em <b>Perfil › Bloqueios e denúncias</b>.
            </p>
            {blocked ? (
              <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-zinc-900 dark:text-brand-500">Você bloqueou @{username}.</p>
            ) : (
              <p className="text-sm text-zinc-500">Se não quiser mais ver @{username} enquanto isso, bloqueie a conta.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {!blocked && (
                <button type="button" onClick={alsoBlock} className="min-h-12 rounded-full bg-zinc-100 px-5 font-extrabold dark:bg-zinc-900">
                  Bloquear @{username}
                </button>
              )}
              <button type="button" onClick={onClose} className="min-h-12 rounded-full bg-brand-600 px-6 font-extrabold text-white">
                Pronto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
