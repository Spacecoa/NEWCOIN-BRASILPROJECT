import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useState } from 'react';
import { fullDate, relativeTime } from '../lib/time.js';
import { learnLocal } from '../lib/deviceAlgo.js';
import { getCachedMode } from '../lib/rankingMode.js';
import { useToken } from '../lib/token.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import RichText from './RichText.jsx';
import WhyPanel from './WhyPanel.jsx';

// Ação minimalista: ícone em traço, contador só quando > 0, alvo de toque de 44 px.
function ActionButton({ label, icon, active = false, count, onClick, hideCount = false, disabled = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`-ml-2 flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-2 text-sm tabular-nums transition-colors hover:text-brand-600 ${
        active ? 'text-brand-600' : 'text-zinc-400'
      }`}
    >
      <Icon name={icon} filled={active && icon === 'heart'} className="h-[18px] w-[18px]" />
      {!hideCount && count > 0 && <span>{count}</span>}
    </button>
  );
}

/**
 * Renderiza um post. Se for repost, mostra o original com o cabeçalho "X repostou".
 * `store` = { posts, users } normalizados; `onChange` recebe { data, includes }.
 */
export default function PostCard({ post, store, onChange, onDelete, highlight = false, hideMetrics = false }) {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const token = useToken();
  const [tipError, setTipError] = useState(null);
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
    // Modo aparelho: o servidor não aprende; o navegador aprende com o mesmo sinal.
    if (getCachedMode() === 'device') {
      const signal = path === 'like' ? (active ? 'unlike' : 'like') : active ? null : 'repost';
      if (signal) learnLocal(me.id, shown, signal, author?.username);
    }
  }

  async function tip() {
    if (!me) return navigate('/login');
    if (shown.viewer.tipped) return;
    setTipError(null);
    try {
      onChange?.(await api(`/api/posts/${shown.id}/recompensa`, { method: 'POST' }));
    } catch (err) {
      setTipError(err.message);
    }
  }

  async function remove() {
    if (!confirm('Apagar este post?')) return;
    await api(`/api/posts/${post.id}`, { method: 'DELETE' });
    onDelete?.(post.id);
  }

  return (
    <article
      onClick={() => !highlight && navigate(`/post/${shown.id}`)}
      className={`px-4 py-3 ${highlight ? '' : 'cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60'}`}
    >
      {reposter && (
        <p className="mb-1 ml-[52px] flex items-center gap-1 text-xs text-zinc-500">
          <Icon name="repost" className="h-3.5 w-3.5" />
          {reposter.id === me?.id ? 'Você repostou' : `${reposter.display_name} repostou`}
        </p>
      )}
      <div className="flex gap-3">
        <Link to={`/u/${author?.username}`} onClick={(e) => e.stopPropagation()} className="h-fit">
          <Avatar user={author} />
        </Link>
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-baseline gap-x-1.5">
            <Link to={`/u/${author?.username}`} onClick={(e) => e.stopPropagation()} className="font-extrabold hover:underline">
              {author?.display_name}
            </Link>
            <span className="text-sm text-zinc-400">@{author?.username}</span>
            <span className="text-sm text-zinc-400">·</span>
            <time dateTime={shown.created_at} title={fullDate(shown.created_at)} className="text-sm text-zinc-400">
              {relativeTime(shown.created_at)}
            </time>
          </header>
          {shown.in_reply_to_post_id && (
            <p className="text-xs text-zinc-400">
              Em resposta a {parentAuthor ? <span className="text-brand-600">@{parentAuthor.username}</span> : 'um post'}
            </p>
          )}
          <div className={highlight ? 'mt-2 text-xl leading-snug' : 'mt-0.5'}>
            <RichText text={shown.text} />
          </div>
          {highlight && <p className="mt-3 text-sm text-zinc-400">{fullDate(shown.created_at)}</p>}
          <footer className="mt-1 flex max-w-sm items-center justify-between">
            <ActionButton label="Responder" icon="reply" count={reply_count} hideCount={hideMetrics} onClick={() => navigate(`/post/${shown.id}`)} />
            <ActionButton
              label={shown.viewer.reposted ? 'Desfazer repost' : 'Repostar'}
              icon="repost"
              count={repost_count}
              hideCount={hideMetrics}
              active={shown.viewer.reposted}
              onClick={() => act('repost', shown.viewer.reposted)}
            />
            <ActionButton
              label={shown.viewer.liked ? 'Descurtir' : 'Curtir'}
              icon="heart"
              count={like_count}
              hideCount={hideMetrics}
              active={shown.viewer.liked}
              onClick={() => act('like', shown.viewer.liked)}
            />
            {!(me && shown.author_id === me.id) && (
              <ActionButton
                label={shown.viewer.tipped ? `Você recompensou com 1 ${token.symbol}` : `Recompensar com 1 ${token.symbol}`}
                icon="coin"
                count={shown.public_metrics.tip_count}
                hideCount={hideMetrics}
                active={shown.viewer.tipped}
                onClick={tip}
              />
            )}
            {me && post.author_id === me.id && !repostRef ? (
              <ActionButton label="Apagar" icon="trash" onClick={remove} />
            ) : (
              <span className="w-11" />
            )}
          </footer>
          {tipError && (
            <p role="alert" className="text-xs text-rose-600" onClick={(e) => e.stopPropagation()}>
              {tipError}{' '}
              <Link to="/missoes" className="underline">Ver missões</Link>
            </p>
          )}
          {post.ranking && <WhyPanel post={post} onHide={onDelete} authorUsername={author?.username} />}
        </div>
      </div>
    </article>
  );
}
