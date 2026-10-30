import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import Avatar from '../components/Avatar.jsx';
import Feed from '../components/Feed.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

const MIN_CHARS = 2;

function People({ q }) {
  const [results, setResults] = useState(null);
  useEffect(() => {
    setResults(null);
    api(`/api/users?q=${encodeURIComponent(q)}`)
      .then((r) => setResults(r.data))
      .catch(() => setResults([]));
  }, [q]);
  if (!results) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  if (!results.length) return <p className="p-8 text-center text-zinc-500">Ninguém com esse nome.</p>;
  return (
    <ul className="px-4">
      {results.map((u) => (
        <li key={u.id}>
          <Link to={`/u/${u.username}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <Avatar user={u} size="sm" />
            <span className="font-semibold">{u.display_name}</span>
            <span className="text-sm text-zinc-500">@{u.username}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Explorar: sem busca, a timeline pública da instância. Com busca, posts (mais recentes
 * primeiro, sem ordenar por curtidas) ou pessoas. A busca fica na URL (?q=), então dá para
 * voltar a ela e compartilhar o link.
 */
export default function Explore() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const tab = params.get('aba') === 'pessoas' ? 'pessoas' : 'posts';
  const [draft, setDraft] = useState(params.get('q') ?? '');

  // Espera a pessoa parar de digitar para buscar (e para não encher o histórico).
  useEffect(() => {
    const t = setTimeout(() => {
      setParams((p) => {
        const next = new URLSearchParams(p);
        if (draft.trim()) next.set('q', draft.trim());
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [draft, setParams]);

  const searching = q.length >= MIN_CHARS;
  const setTab = (key) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (key === 'pessoas') next.set('aba', 'pessoas');
      else next.delete('aba');
      return next;
    }, { replace: true });

  return (
    <>
      <PageHeader title="Explorar" subtitle={searching ? `Resultados para “${q}”` : 'Timeline pública desta instância'} />
      <form role="search" className="px-4 pb-3" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Buscar posts e pessoas"
          aria-label="Buscar posts e pessoas"
          maxLength={100}
          className="min-h-11 w-full rounded-full bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
        />
        {q.length === 1 && <p className="mt-2 text-sm text-zinc-500">Digite pelo menos {MIN_CHARS} letras.</p>}
      </form>
      {searching ? (
        <>
          <div role="tablist" aria-label="O que buscar" className="mx-4 mb-2 grid grid-cols-2 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
            {[
              ['posts', 'Posts'],
              ['pessoas', 'Pessoas'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-10 rounded-full text-sm ${tab === key ? 'bg-white font-extrabold shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'posts' ? (
            <>
              <p className="px-4 pb-1 text-xs text-zinc-500">Mais recentes primeiro. Use “aspas” para uma frase exata e <span className="whitespace-nowrap">-palavra</span> para excluir.</p>
              <Feed endpoint={`/api/posts/busca?q=${encodeURIComponent(q)}`} emptyText="Nenhum post com essas palavras." />
            </>
          ) : (
            <People q={q} />
          )}
        </>
      ) : (
        <Feed endpoint="/api/posts" />
      )}
    </>
  );
}
