import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api, withParams } from '../lib/api.js';
import { usePostStore } from '../lib/usePostStore.js';
import PostCard from './PostCard.jsx';

const PAGE_SIZE = 20;

/**
 * Lista de posts em ordem cronológica reversa com rolagem infinita.
 * Paginação por cursor: cada página pede `until_id = meta.next_token` da anterior
 * (equivalente ao pagination_token / until_id da X API v2).
 *
 * Com `live`, escuta o evento `timeline:new` e mostra "Mostrar N posts novos" —
 * ao clicar, busca com `since_id` (o mesmo padrão do X: não insere automaticamente
 * para não deslocar o conteúdo que a pessoa está lendo).
 */
export default function Feed({ endpoint, live = false, emptyText = 'Nada por aqui ainda.', header }) {
  const { socket } = useAuth();
  const store = usePostStore();
  const { merge, remove } = store;
  const [ids, setIds] = useState([]);
  const [nextToken, setNextToken] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(() => new Set());
  const loadingRef = useRef(false);
  const sentinel = useRef(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  // Incrementa a cada troca de endpoint; respostas de gerações antigas são descartadas.
  const generation = useRef(0);

  const loadMore = useCallback(
    async (reset = false) => {
      if (loadingRef.current && !reset) return;
      const gen = generation.current;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await api(withParams(endpoint, { max_results: PAGE_SIZE, until_id: reset ? null : nextToken }));
        if (gen !== generation.current) return;
        merge(result);
        const newIds = result.data.map((p) => p.id);
        setIds((prev) => (reset ? newIds : [...prev, ...newIds.filter((id) => !prev.includes(id))]));
        setNextToken(result.meta.next_token ?? null);
        setDone(!result.meta.next_token);
      } catch (err) {
        if (gen === generation.current) setError(err.message);
      } finally {
        if (gen === generation.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [endpoint, nextToken, merge],
  );

  // Recarrega do zero quando o endpoint muda (ex.: trocar de perfil ou aba).
  useEffect(() => {
    generation.current += 1;
    setIds([]);
    setNextToken(null);
    setDone(false);
    setPending(new Set());
    loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // Rolagem infinita: quando o sentinela entra na tela, carrega a próxima página.
  useEffect(() => {
    if (done || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && idsRef.current.length) loadMore();
    }, { rootMargin: '400px' });
    obs.observe(sentinel.current);
    return () => obs.disconnect();
  }, [done, loadMore]);

  useEffect(() => {
    if (!live || !socket) return;
    const onNew = (post) => {
      if (!idsRef.current.includes(post.data.id)) setPending((prev) => new Set(prev).add(post.data.id));
    };
    const onDeleted = ({ id }) => setIds((prev) => prev.filter((x) => x !== id));
    socket.on('timeline:new', onNew);
    socket.on('post:deleted', onDeleted);
    return () => {
      socket.off('timeline:new', onNew);
      socket.off('post:deleted', onDeleted);
    };
  }, [live, socket]);

  const prepend = useCallback(
    (result) => {
      merge(result);
      const list = Array.isArray(result.data) ? result.data : [result.data];
      const newIds = list.map((p) => p.id);
      setIds((prev) => [...newIds.filter((id) => !prev.includes(id)), ...prev]);
      setPending((prev) => new Set([...prev].filter((id) => !newIds.includes(id))));
    },
    [merge],
  );

  async function showPending() {
    const result = await api(withParams(endpoint, { max_results: 100, since_id: ids[0] ?? null }));
    prepend(result);
    setPending(new Set());
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  const handleDelete = (id) => {
    setIds((prev) => prev.filter((x) => x !== id));
    remove(id);
  };

  return (
    <section aria-label="Feed" aria-busy={loading}>
      {header?.(prepend)}
      {pending.size > 0 && (
        <button
          type="button"
          onClick={showPending}
          className="mx-auto my-2 flex min-h-11 items-center rounded-full bg-brand-50 px-5 text-sm font-extrabold text-brand-700 dark:bg-brand-600/15 dark:text-brand-100"
        >
          Mostrar {pending.size} {pending.size === 1 ? 'post novo' : 'posts novos'}
        </button>
      )}
      {ids.map((id) =>
        store.posts[id] ? <PostCard key={id} post={store.posts[id]} store={store} onChange={merge} onDelete={handleDelete} /> : null,
      )}
      {error && (
        <p role="alert" className="p-4 text-center text-rose-600">
          {error} <button className="underline" onClick={() => loadMore()}>Tentar de novo</button>
        </p>
      )}
      {!loading && done && ids.length === 0 && <p className="p-8 text-center text-zinc-500">{emptyText}</p>}
      <div ref={sentinel} className="flex justify-center p-4">
        {loading ? (
          <span className="text-sm text-zinc-500">Carregando…</span>
        ) : (
          !done && ids.length > 0 && (
            <button type="button" onClick={() => loadMore()} className="min-h-11 rounded-full px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50 dark:hover:bg-zinc-900">
              Carregar mais
            </button>
          )
        )}
      </div>
    </section>
  );
}
