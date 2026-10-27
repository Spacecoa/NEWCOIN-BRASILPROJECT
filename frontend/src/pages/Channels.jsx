import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

const KIND_LABEL = { channel: 'Canal (broadcast)', group: 'Grupo' };

export default function Channels() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/channels').then((r) => setChannels(r.data)).catch((e) => setError(e.message));
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
      <PageHeader title="Canais e grupos" subtitle="Mensageria em tempo real (inspirada no Telegram)">
        <button onClick={() => setShowForm((v) => !v)} className="rounded-full bg-brand-600 px-3 py-1 text-sm font-semibold text-white">
          {showForm ? 'Cancelar' : 'Criar'}
        </button>
      </PageHeader>
      {showForm && (
        <form onSubmit={create} className="space-y-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <input name="slug" required pattern="[A-Za-z0-9_]{3,32}" placeholder="identificador (ex.: estudos_p2p)" className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
          <input name="title" required maxLength={64} placeholder="Título" className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
          <input name="description" maxLength={255} placeholder="Descrição (opcional)" className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
          <select name="kind" className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700">
            <option value="group">Grupo — todos os membros escrevem</option>
            <option value="channel">Canal — só administradores publicam</option>
          </select>
          <button className="rounded-full bg-brand-600 px-4 py-1.5 font-semibold text-white">Criar</button>
        </form>
      )}
      {error && <p role="alert" className="p-4 text-rose-600">{error}</p>}
      {!channels ? (
        <p className="p-8 text-center text-zinc-500">Carregando…</p>
      ) : (
        <ul>
          {channels.map((c) => (
            <li key={c.id} className="border-b border-zinc-200 dark:border-zinc-800">
              <Link to={`/canais/${c.slug}`} className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <p className="font-semibold">
                  {c.kind === 'channel' ? '📣' : '💬'} {c.title}
                  {c.viewer_role && <span className="ml-2 rounded bg-brand-100 px-1.5 text-xs text-brand-700">{c.viewer_role}</span>}
                </p>
                <p className="text-sm text-zinc-500">{c.description || KIND_LABEL[c.kind]}</p>
                <p className="text-xs text-zinc-400">{KIND_LABEL[c.kind]} · {c.member_count} membros · pts {c.pts}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
