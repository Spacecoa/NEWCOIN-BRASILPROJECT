import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { loadReasons, RESOLUTION_LABEL } from '../lib/moderation.js';
import { relativeTime } from '../lib/time.js';

const TABS = [
  ['aberta', 'Abertas'],
  ['acatada', 'Acatadas'],
  ['arquivada', 'Arquivadas'],
];

const ACTION_TEXT = {
  arquivar: { label: 'Arquivar', confirm: null },
  remover_post: { label: 'Remover post', confirm: 'O post sai do ar para todo mundo. As outras denúncias deste post são resolvidas junto.' },
  suspender: { label: 'Suspender conta', confirm: 'A conta é desconectada na hora, não consegue mais entrar e os posts somem para todos. Dá para reativar depois.' },
};

function ReportCard({ r, reasons, onDone }) {
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = r.status === 'aberta';

  async function decide(action) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/moderacao/denuncias/${r.id}/resolver`, { method: 'POST', body: { action, note } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <li className="rounded-3xl bg-zinc-50 p-4 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-extrabold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
          {reasons[r.reason] ?? r.reason}
        </span>
        <span className="text-xs text-zinc-500">{relativeTime(r.created_at)}</span>
      </div>
      <p className="mt-2 text-sm">
        {r.post_text != null ? 'Post de ' : 'Conta '}
        <Link to={`/u/${r.target_username}`} className="font-extrabold text-brand-600">@{r.target_username}</Link>
        {r.target_suspended && <span className="ml-2 text-xs font-extrabold text-rose-600">suspensa</span>}
        {open && r.open_against_target > 1 && <span className="ml-2 text-xs text-zinc-500">{r.open_against_target} denúncias abertas contra esta conta</span>}
      </p>
      {r.post_text != null && (
        <blockquote className="mt-2 rounded-2xl bg-white p-3 text-sm dark:bg-zinc-950">
          {r.post_text}
          {!r.post_exists && <span className="mt-1 block text-xs text-zinc-500">(o post já não existe)</span>}
        </blockquote>
      )}
      {r.details && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">“{r.details}” — @{r.reporter_username}</p>}
      {!r.details && <p className="mt-2 text-xs text-zinc-500">Denunciado por @{r.reporter_username}</p>}

      {open ? (
        <div className="mt-3 space-y-2">
          <label className="block text-sm">
            <span className="sr-only">Nota da decisão</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Nota da decisão (quem denunciou vê)"
              className="min-h-11 w-full rounded-2xl bg-white px-4 outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-950"
            />
          </label>
          {confirm ? (
            <div role="group" aria-label="Confirmar decisão" className="rounded-2xl bg-white p-3 text-sm dark:bg-zinc-950">
              <p>{ACTION_TEXT[confirm].confirm}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => decide(confirm)} className="min-h-11 rounded-full bg-rose-600 px-4 font-extrabold text-white disabled:opacity-50">
                  {ACTION_TEXT[confirm].label}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="min-h-11 rounded-full px-4 text-zinc-600 dark:text-zinc-300">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => decide('arquivar')} className="min-h-11 rounded-full bg-white px-4 text-sm font-extrabold dark:bg-zinc-950">
                Arquivar
              </button>
              {r.post_exists && (
                <button type="button" onClick={() => setConfirm('remover_post')} className="min-h-11 rounded-full bg-white px-4 text-sm font-extrabold text-rose-600 dark:bg-zinc-950">
                  Remover post
                </button>
              )}
              {!r.target_suspended && (
                <button type="button" onClick={() => setConfirm('suspender')} className="min-h-11 rounded-full bg-white px-4 text-sm font-extrabold text-rose-600 dark:bg-zinc-950">
                  Suspender conta
                </button>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm">
          {RESOLUTION_LABEL[r.resolution]} <span className="text-zinc-500">por @{r.resolved_by_username} {r.resolved_at && relativeTime(r.resolved_at)}</span>
          {r.resolution_note && <span className="block text-zinc-500">Nota: {r.resolution_note}</span>}
        </p>
      )}
    </li>
  );
}

/** Fila de denúncias da instância (só para quem modera). */
export default function Moderation() {
  const [status, setStatus] = useState('aberta');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [reasons, setReasons] = useState({});

  const load = useCallback(() => {
    setError(null);
    api(`/api/moderacao/denuncias?status=${status}`)
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.message));
  }, [status]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);
  useEffect(() => {
    loadReasons().then((list) => setReasons(Object.fromEntries(list.map((r) => [r.id, r.label]))));
  }, []);

  return (
    <>
      <PageHeader back title="Fila da moderação" subtitle="Denúncias desta instância" />
      <div role="tablist" className="flex gap-2 px-4 pb-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={`min-h-10 rounded-full px-4 text-sm ${status === key ? 'bg-zinc-900 font-extrabold text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="px-4 pb-8">
        {error && <p role="alert" className="py-8 text-center text-zinc-500">{error}</p>}
        {!error && !items && <p className="py-8 text-center text-zinc-400">Carregando…</p>}
        {items && !items.length && (
          <p className="py-8 text-center text-zinc-500">{status === 'aberta' ? 'Nenhuma denúncia esperando decisão.' : 'Nada por aqui.'}</p>
        )}
        {items && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((r) => (
              <ReportCard key={r.id} r={r} reasons={reasons} onDone={load} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
