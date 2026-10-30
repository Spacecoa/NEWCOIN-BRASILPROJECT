import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import Avatar from '../components/Avatar.jsx';
import Feed from '../components/Feed.jsx';
import Icon from '../components/Icon.jsx';
import LoadError from '../components/LoadError.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { describeGroup, groupNotifications, unreadStore, useUnreadCount } from '../lib/notifications.js';
import { relativeTime } from '../lib/time.js';

const ICON = {
  like: ['heart', 'text-rose-500'],
  repost: ['repost', 'text-emerald-600'],
  reply: ['reply', 'text-sky-600'],
  mention: ['at', 'text-sky-600'],
  follow: ['user', 'text-brand-600'],
  tip: ['coin', 'text-amber-500'],
  quote: ['quote', 'text-emerald-600'],
};

function NotificationItem({ group, users, posts }) {
  const actors = group.actor_ids.map((id) => users[id]).filter(Boolean);
  const names = Object.fromEntries(actors.map((u) => [u.id, u.display_name]));
  const post = group.post_id ? posts[group.post_id] : null;
  const to = group.kind === 'follow' ? `/u/${actors[0]?.username}` : `/post/${group.post_id}`;
  const [icon, color] = ICON[group.kind];
  // Respostas e menções mostram o post de quem escreveu; nos demais, o post é seu.
  const theirs = group.kind === 'reply' || group.kind === 'mention' || group.kind === 'quote';
  return (
    <li>
      <Link
        to={to}
        className={`flex gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60 ${group.read ? '' : 'bg-brand-50/60 dark:bg-brand-600/10'}`}
      >
        <span className={`mt-1 shrink-0 ${color}`}>
          <Icon name={icon} filled={group.kind === 'like'} className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex gap-1">
            {actors.slice(0, 3).map((u) => (
              <Avatar key={u.id} user={u} size="sm" />
            ))}
          </span>
          <span className="mt-1 block">
            <span className="font-semibold">{describeGroup(group, names)}</span>
            <span className="text-zinc-500"> · {relativeTime(group.created_at)}</span>
            {!group.read && <span className="sr-only"> (nova)</span>}
          </span>
          {post && <span className={`mt-1 line-clamp-3 text-sm ${theirs ? '' : 'text-zinc-500'}`}>{post.text}</span>}
        </span>
      </Link>
    </li>
  );
}

function AllNotifications() {
  const [state, setState] = useState(null); // { items, users, posts, next }
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const unread = useUnreadCount();

  const index = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

  async function load() {
    setError(null);
    try {
      const r = await api('/api/notificacoes');
      setState({ items: r.data, users: index(r.includes.users), posts: index(r.includes.posts), next: r.meta.next_token ?? null });
      unreadStore.set(r.meta.unread_count);
      // Abrir a tela é ler: marca até o mais novo que apareceu (o que chegar depois continua novo).
      if (r.meta.unread_count && r.meta.newest_id) {
        const { unread_count: left } = await api('/api/notificacoes/lidas', { method: 'POST', body: { newest_id: r.meta.newest_id } });
        unreadStore.set(left);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function more() {
    setLoadingMore(true);
    try {
      const r = await api(`/api/notificacoes?until_id=${state.next}`);
      setState((s) => ({
        items: [...s.items, ...r.data],
        users: { ...s.users, ...index(r.includes.users) },
        posts: { ...s.posts, ...index(r.includes.posts) },
        next: r.meta.next_token ?? null,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error && !state) return <LoadError message={error} onRetry={load} />;
  if (!state) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const groups = groupNotifications(state.items);
  return (
    <>
      {unread > 0 && (
        <button type="button" onClick={load} className="mx-auto my-2 flex min-h-11 items-center rounded-full bg-brand-50 px-5 text-sm font-extrabold text-brand-700 dark:bg-brand-600/15 dark:text-brand-100">
          Mostrar {unread === 1 ? '1 notificação nova' : `${unread} notificações novas`}
        </button>
      )}
      {groups.length === 0 ? (
        <p className="p-8 text-center text-zinc-500">Nada por aqui ainda. Quando alguém curtir, responder, repostar, recompensar ou seguir você, aparece aqui.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {groups.map((g) => (
            <NotificationItem key={g.key} group={g} users={state.users} posts={state.posts} />
          ))}
        </ul>
      )}
      {error && <p role="alert" className="p-4 text-center text-rose-600">{error}</p>}
      {state.next && (
        <div className="flex justify-center p-4">
          <button type="button" onClick={more} disabled={loadingMore} className="min-h-11 rounded-full bg-zinc-100 px-5 font-extrabold disabled:opacity-50 dark:bg-zinc-900">
            {loadingMore ? 'Carregando…' : 'Ver mais antigas'}
          </button>
        </div>
      )}
    </>
  );
}

export default function Notifications() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'mencoes' ? 'mencoes' : 'tudo';
  return (
    <>
      <PageHeader title="Notificações" subtitle={tab === 'mencoes' ? 'Posts que citam você' : 'Quem interagiu com você'} />
      <div role="tablist" aria-label="Tipo de notificação" className="mx-4 mb-2 grid grid-cols-2 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
        {[
          ['tudo', 'Tudo'],
          ['mencoes', 'Menções'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'tudo' ? {} : { aba: key }, { replace: true })}
            className={`min-h-10 rounded-full text-sm ${tab === key ? 'bg-white font-extrabold shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'tudo' ? <AllNotifications /> : <Feed endpoint="/api/mentions" emptyText="Ninguém mencionou você ainda." />}
    </>
  );
}
