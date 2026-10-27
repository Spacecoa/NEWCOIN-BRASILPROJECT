import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import Composer from '../components/Composer.jsx';
import PageHeader from '../components/PageHeader.jsx';
import PostCard from '../components/PostCard.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { learnLocal } from '../lib/deviceAlgo.js';
import { getCachedMode } from '../lib/rankingMode.js';
import { buildThread } from '../lib/thread.js';
import { usePostStore } from '../lib/usePostStore.js';

function ReplyTree({ nodes, store, onDelete, depth = 0 }) {
  return nodes.map(({ post, children }) => (
    <div key={post.id} className={depth ? 'border-l border-zinc-100 dark:border-zinc-900' : ''} style={{ marginLeft: depth ? Math.min(depth, 3) * 12 : 0 }}>
      <PostCard post={store.posts[post.id] ?? post} store={store} onChange={store.merge} onDelete={onDelete} />
      <ReplyTree nodes={children} store={store} onDelete={onDelete} depth={depth + 1} />
    </div>
  ));
}

export default function Thread() {
  const { id } = useParams();
  const store = usePostStore();
  const { merge } = store;
  const { user: me } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    api(`/api/posts/${id}/thread`)
      .then((r) => {
        merge(r);
        setOrder(r.data.map((p) => p.id));
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    setOrder(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <p className="p-8 text-center text-zinc-500">{error}</p>;
  if (!order) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;

  const posts = order.map((pid) => store.posts[pid]).filter(Boolean);
  const { ancestors, focal, replies } = buildThread(posts, id);
  if (!focal) return <p className="p-8 text-center text-zinc-500">Post não encontrado.</p>;

  return (
    <>
      <PageHeader back title="Thread" subtitle={`${posts.length} posts nesta conversa`} />
      {ancestors.map((p) => (
        <div key={p.id} className="opacity-90">
          <PostCard post={p} store={store} onChange={merge} />
        </div>
      ))}
      <div className="border-y border-zinc-100 dark:border-zinc-900">
        <PostCard post={focal} store={store} onChange={merge} highlight />
      </div>
      <Composer
        replyTo={focal.id}
        placeholder={`Responder a @${store.users[focal.author_id]?.username ?? ''}`}
        onPosted={(result) => {
          merge(result);
          if (getCachedMode() === 'device') learnLocal(me.id, focal, 'reply', store.users[focal.author_id]?.username);
          setOrder((prev) => [...prev, result.data.id]);
        }}
      />
      <ReplyTree nodes={replies} store={store} onDelete={load} />
    </>
  );
}
