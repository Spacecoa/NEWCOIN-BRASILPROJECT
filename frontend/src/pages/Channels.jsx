import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import Icon from '../components/Icon.jsx';
import LoadError from '../components/LoadError.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

const KIND_LABEL = { channel: 'Canal (broadcast)', group: 'Grupo' };

export default function Channels() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  const [loadError, setLoadError] = useState(null);
  const load = () => {
    setLoadError(null);
    api('/api/channels').then((r) => setChannels(r.data)).catch((e) => setLoadError(e.message));
  };
  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const { data } = await api('/api/channels', {
        method: 'POST',
        body: { slug: f.get('slug'), title: f.get('title'), description: f.get('description'), kind: f.get('kind') },
      });
      navigate(`/canais/${data.slug}`);
    } catch (err) {
      setError(err.details?.map((d) => `${d.path}: ${d.message}`).join(' · ') || err.message);
    }
  }

  return (
    <>
      <PageHeader title="Canais" subtitle="Grupos e canais em tempo real">
        <button
          onClick={() => setShowForm((v) => !v)}
          aria-label={showForm ? 'Cancelar' : 'Criar canal'}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900"
        >
          <Icon name={showForm ? 'close' : 'plus'} />
        </button>
      </PageHeader>
      {showForm && (
        <form onSubmit={create} className="space-y-2 px-4 pb-4">
          <input name="slug" required pattern="[A-Za-z0-9_]{3,32}" placeholder="identificador (ex.: estudos_p2p)" className="min-h-12 w-full rounded-2xl bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900" />
          <input name="title" required maxLength={64} placeholder="Título" className="min-h-12 w-full rounded-2xl bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900" />
          <input name="description" maxLength={255} placeholder="Descrição (opcional)" className="min-h-12 w-full rounded-2xl bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900" />
          <select name="kind" className="min-h-12 w-full rounded-2xl bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900">
            <option value="group">Grupo — todos os membros escrevem</option>
            <option value="channel">Canal — só administradores publicam</option>
          </select>
          <button className="min-h-11 rounded-full bg-brand-600 px-5 font-extrabold text-white">Criar</button>
        </form>
      )}
      {error && <p role="alert" className="p-4 text-rose-600">{error}</p>}
      {loadError && !channels ? (
        <LoadError message={loadError} onRetry={load} />
      ) : !channels ? (
        <p className="p-8 text-center text-zinc-500">Carregando…</p>
      ) : (
        <ul>
          {channels.map((c) => (
            <li key={c.id}>
              <Link to={`/canais/${c.slug}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  <Icon name={c.kind === 'channel' ? 'megaphone' : 'channels'} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-extrabold">
                    <span className="truncate">{c.title}</span>
                    {c.viewer_role && <span className="rounded-full bg-brand-50 px-2 text-xs font-semibold text-brand-700 dark:bg-brand-600/15 dark:text-brand-100">{c.viewer_role}</span>}
                  </span>
                  <span className="block truncate text-sm text-zinc-500">{c.description || KIND_LABEL[c.kind]}</span>
                  <span className="block text-xs text-zinc-400">{KIND_LABEL[c.kind]} · {c.member_count} membros</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
