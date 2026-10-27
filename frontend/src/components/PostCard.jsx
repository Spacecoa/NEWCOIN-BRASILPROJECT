import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { fullDate, relativeTime } from '../lib/time.js';
import Avatar from './Avatar.jsx';
import RichText from './RichText.jsx';

function ActionButton({ label, active, activeClass, count, onClick, icon }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${active ? activeClass : 'text-zinc-500'}`}
    >
      <span aria-hidden>{icon}</span>
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

/**
 * Renderiza um post. Se for repost, mostra o original com o cabeçalho "X repostou".
 * `store` = { posts, users } normalizados; `onChange` recebe { data, includes }.
 */
export default function PostCard({ post, store, onChange, onDelete, highlight = false }) {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const repostRef = post.referenced_posts.find((r) => r.type === 'reposted');
  const shown = repostRef ? store.posts[repostRef.id] : post;
  if (!shown) return null; // original apagado
  const author = store.users[shown.author_id];
  const reposter = repostRef ? store.users[post.author_id] : null;
  const parent = shown.in_reply_to_post_id ? store.posts[shown.in_reply_to_post_id] : null;
  const parentAuthor = parent ? store.users[parent.author_id] : null;
  const { like_count, reply_count, repost_count } = shown.public_metrics;

  async function act(path, active) {
    if (!me) return navigate('/login');
    onChange?.(await api(`/api/posts/${shown.id}/${path}`, { method: active ? 'DELETE' : 'POST' }));
  }

  async function remove() {
    if (!confirm('Apagar este post?')) return;
    await api(`/api/posts/${post.id}`, { method: 'DELETE' });
    onDelete?.(post.id);
  }

  return (
    <article
      onClick={() => !highlight && navigate(`/post/${shown.id}`)}
      className={`border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 ${highlight ? '' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50'}`}
    >
      {reposter && (
        <p className="mb-1 ml-12 text-xs font-semibold text-zinc-500">
          🔁 {reposter.id === me?.id ? 'Você repostou' : `${reposter.display_name} repostou`}
        </p>
      )}
      <div className="flex gap-3">
        <Link to={`/u/${author?.username}`} onClick={(e) => e.stopPropagation()}>
          <Avatar user={author} />
        </Link>
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <Link to={`/u/${author?.username}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline">
              {author?.display_name}
            </Link>
            <span className="text-zinc-500">@{author?.username}</span>
            <span className="text-zinc-400">·</span>
            <time dateTime={shown.created_at} title={fullDate(shown.created_at)} className="text-zinc-500">
              {relativeTime(shown.created_at)}
            </time>
          </header>
          {shown.in_reply_to_post_id && (
            <p className="text-xs text-zinc-500">
              Em resposta a {parentAuthor ? <span className="text-brand-600">@{parentAuthor.username}</span> : 'um post'}
            </p>
          )}
          <div className={highlight ? 'mt-2 text-xl' : 'mt-0.5'}>
            <RichText text={shown.text} />
          </div>
          {highlight && <p className="mt-3 text-sm text-zinc-500">{fullDate(shown.created_at)}</p>}
          <footer className="-ml-2 mt-2 flex max-w-md justify-between">
            <ActionButton label="Responder" icon="💬" count={reply_count} onClick={() => navigate(`/post/${shown.id}`)} />
            <ActionButton
              label={shown.viewer.reposted ? 'Desfazer repost' : 'Repostar'}
              icon="🔁"
              count={repost_count}
              active={shown.viewer.reposted}
              activeClass="text-emerald-600"
              onClick={() => act('repost', shown.viewer.reposted)}
            />
            <ActionButton
              label={shown.viewer.liked ? 'Descurtir' : 'Curtir'}
              icon={shown.viewer.liked ? '♥' : '♡'}
              count={like_count}
              active={shown.viewer.liked}
              activeClass="text-rose-600"
              onClick={() => act('like', shown.viewer.liked)}
            />
            {me && post.author_id === me.id && !repostRef ? (
              <ActionButton label="Apagar" icon="🗑" onClick={remove} />
            ) : (
              <span className="w-8" />
            )}
          </footer>
        </div>
      </div>
    </article>
  );
}
