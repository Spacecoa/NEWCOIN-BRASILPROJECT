import { Link, useNavigate } from 'react-router';
import { useLoginRedirect } from '../lib/useLoginRedirect.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useState } from 'react';
import { fullDate, relativeTime } from '../lib/time.js';
import { learnLocal } from '../lib/deviceAlgo.js';
import { useToken } from '../lib/token.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import RichText from './RichText.jsx';
import WhyPanel from './WhyPanel.jsx';
import PostMenu from './PostMenu.jsx';
import ReportDialog from './ReportDialog.jsx';
import EditHistory from './EditHistory.jsx';
import QuoteDialog from './QuoteDialog.jsx';
import QuotedPost from './QuotedPost.jsx';
import { block, mute } from '../lib/moderation.js';

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
/**
 * Imagens do post. A descrição vai no alt (leitores de tela) e aparece ao tocar em "Descrição".
 * Uma imagem ocupa a largura toda na proporção dela; duas a quatro viram uma grade.
 */
function PostMedia({ media }) {
  const single = media.length === 1;
  return (
    <div className={`mt-2 grid gap-1 overflow-hidden rounded-2xl ${single ? '' : 'grid-cols-2'}`}>
      {media.map((m) => (
        <figure key={m.id} className="relative m-0">
          <a href={m.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Abrir imagem: ${m.alt}`}>
            <img
              src={m.url}
              alt={m.alt}
              width={m.width}
              height={m.height}
              loading="lazy"
              className={`w-full bg-zinc-100 object-cover dark:bg-zinc-900 ${single ? 'max-h-[32rem]' : 'aspect-square'}`}
              style={single ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}
            />
          </a>
          <details className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] rounded-lg bg-black/70 text-xs text-white" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer list-none px-2 py-1 font-extrabold">Descrição</summary>
            <p className="px-2 pb-2">{m.alt}</p>
          </details>
        </figure>
      ))}
    </div>
  );
}

export default function PostCard({ post, store, onChange, onDelete, onHideAuthor, highlight = false, hideMetrics = false }) {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const toLogin = useLoginRedirect(); // visitante: ler pode, interagir pede login
  const token = useToken();
  const [tipError, setTipError] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [hidden, setHidden] = useState(null); // { kind: 'mute' | 'block', username }
  const [editing, setEditing] = useState(null); // texto em edição
  const [editError, setEditError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [repostMenu, setRepostMenu] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const repostRef = post.referenced_posts.find((r) => r.type === 'reposted');
  const shown = repostRef ? store.posts[repostRef.id] : post;
  if (!shown) return null; // original apagado
  const author = store.users[shown.author_id];
  const reposter = repostRef ? store.users[post.author_id] : null;
  const parent = shown.in_reply_to_post_id ? store.posts[shown.in_reply_to_post_id] : null;
  const parentAuthor = parent ? store.users[parent.author_id] : null;
  const { like_count, reply_count, repost_count, quote_count = 0 } = shown.public_metrics;
  const quotedRef = shown.referenced_posts.find((r) => r.type === 'quoted');
  const quoted = quotedRef ? store.posts[quotedRef.id] : null;

  async function act(path, active) {
    if (!me) return toLogin();
    onChange?.(await api(`/api/posts/${shown.id}/${path}`, { method: active ? 'DELETE' : 'POST' }));
    // O algoritmo fica só neste aparelho: é aqui que ele aprende com o sinal.
    const signal = path === 'like' ? (active ? 'unlike' : 'like') : active ? null : 'repost';
    if (signal) learnLocal(me.id, shown, signal, author?.username);
  }

  async function tip() {
    if (!me) return toLogin();
    if (shown.viewer.tipped) return;
    setTipError(null);
    try {
      onChange?.(await api(`/api/posts/${shown.id}/recompensa`, { method: 'POST' }));
    } catch (err) {
      setTipError(err.message);
    }
  }

  // Silenciar/bloquear a partir do post: o cartão vira um aviso com "Desfazer" e o feed
  // tira os outros posts da mesma pessoa.
  async function hideAuthor(kind) {
    await (kind === 'mute' ? mute : block)(author.username);
    setHidden({ kind, username: author.username });
    onHideAuthor?.(shown.author_id, post.id);
  }
  async function undoHide() {
    await (hidden.kind === 'mute' ? mute : block)(hidden.username, false);
    setHidden(null);
  }

  async function saveEdit(e) {
    e.preventDefault();
    e.stopPropagation();
    setEditError(null);
    try {
      onChange?.(await api(`/api/posts/${shown.id}`, { method: 'PATCH', body: { text: editing } }));
      setEditing(null);
      setShowHistory(false);
    } catch (err) {
      setEditError(err.message);
    }
  }

  async function remove() {
    if (!confirm('Apagar este post?')) return;
    await api(`/api/posts/${post.id}`, { method: 'DELETE' });
    onDelete?.(post.id);
  }

  // A janela de denúncia fica sempre na mesma posição da árvore: se o cartão virar aviso
  // (bloquear depois de denunciar), ela continua aberta na tela de confirmação.
  const quoteDialog = quoting && (
    <QuoteDialog
      post={shown}
      author={author}
      onClose={() => setQuoting(false)}
      onPosted={(result) => {
        setQuoting(false);
        onChange?.(result);
        onChange?.({ data: { ...shown, public_metrics: { ...shown.public_metrics, quote_count: quote_count + 1 } } });
      }}
    />
  );
  const dialog = reporting && (
    <ReportDialog
      postId={shown.id}
      username={author.username}
      onClose={() => setReporting(false)}
      onBlocked={() => {
        setHidden({ kind: 'block', username: author.username });
        onHideAuthor?.(shown.author_id, post.id);
      }}
    />
  );

  if (hidden) {
    return (
      <>
        {dialog}
        <div role="status" className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-zinc-500">
          <span>
            {hidden.kind === 'mute'
              ? `Você silenciou @${hidden.username}. Os posts dessa conta não aparecem mais nos seus feeds.`
              : `Você bloqueou @${hidden.username}.`}
          </span>
          <button type="button" onClick={undoHide} className="min-h-11 shrink-0 rounded-full px-4 font-extrabold text-brand-600 hover:bg-zinc-50 dark:hover:bg-zinc-900">
            Desfazer
          </button>
        </div>
      </>
    );
  }

  const canModerate = me && author && shown.author_id !== me.id;

  return (
    <>
    {dialog}
    {quoteDialog}
    <article
      onClick={() => !highlight && !reporting && navigate(`/post/${shown.id}`)}
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
            {shown.edit_count > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHistory((v) => !v);
                }}
                aria-expanded={showHistory}
                className="text-sm text-zinc-400 underline-offset-2 hover:underline"
              >
                · editado
              </button>
            )}
            {canModerate && (
              <PostMenu username={author.username} onMute={() => hideAuthor('mute')} onBlock={() => hideAuthor('block')} onReport={() => setReporting(true)} />
            )}
          </header>
          {shown.in_reply_to_post_id && (
            <p className="text-xs text-zinc-400">
              Em resposta a {parentAuthor ? <span className="text-brand-600">@{parentAuthor.username}</span> : 'um post'}
            </p>
          )}
          {editing !== null ? (
            <form onSubmit={saveEdit} onClick={(e) => e.stopPropagation()} className="mt-1">
              <label htmlFor={`edit-${shown.id}`} className="sr-only">Editar post</label>
              <textarea
                id={`edit-${shown.id}`}
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl bg-zinc-50 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
              />
              <p className="text-xs text-zinc-500">A versão anterior fica no histórico, aberta a quem lê.</p>
              {editError && <p role="alert" className="text-sm text-rose-600">{editError}</p>}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={() => { setEditing(null); setEditError(null); }} className="min-h-11 rounded-full px-4 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  Cancelar
                </button>
                <button disabled={!editing.trim() || editing.length > 280} className="min-h-11 rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white disabled:opacity-40">
                  Salvar edição
                </button>
              </div>
            </form>
          ) : (
            <div className={highlight ? 'mt-2 text-xl leading-snug' : 'mt-0.5'}>
              <RichText text={shown.text} />
            </div>
          )}
          {showHistory && <EditHistory postId={shown.id} />}
          {shown.media?.length > 0 && <PostMedia media={shown.media} />}
          {quotedRef && <QuotedPost post={quoted} author={quoted ? store.users[quoted.author_id] : null} />}
          {highlight && quote_count > 0 && <p className="mt-2 text-sm text-zinc-500">{quote_count} {quote_count === 1 ? 'citação' : 'citações'}</p>}
          {highlight && <p className="mt-3 text-sm text-zinc-400">{fullDate(shown.created_at)}</p>}
          <footer className="mt-1 flex max-w-sm items-center justify-between">
            <ActionButton label="Responder" icon="reply" count={reply_count} hideCount={hideMetrics} onClick={() => navigate(`/post/${shown.id}`)} />
            {/* Repostar ou citar: o mesmo botão abre as duas opções. */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <ActionButton
                label="Repostar ou citar"
                icon="repost"
                count={repost_count}
                hideCount={hideMetrics}
                active={shown.viewer.reposted}
                onClick={() => (me ? setRepostMenu((v) => !v) : toLogin())}
              />
              {repostMenu && (
                <div role="menu" className="absolute left-0 top-10 z-20 w-52 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-zinc-100 dark:bg-zinc-950 dark:ring-zinc-800">
                  <button role="menuitem" type="button" onClick={() => { setRepostMenu(false); act('repost', shown.viewer.reposted); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <Icon name="repost" className="h-5 w-5 text-zinc-500" /> {shown.viewer.reposted ? 'Desfazer repost' : 'Repostar'}
                  </button>
                  <button role="menuitem" type="button" onClick={() => { setRepostMenu(false); setQuoting(true); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <Icon name="quote" className="h-5 w-5 text-zinc-500" /> Citar
                  </button>
                </div>
              )}
            </div>
            <ActionButton
              label={shown.viewer.liked ? 'Descurtir' : 'Curtir'}
              icon="heart"
              count={like_count}
              hideCount={hideMetrics}
              active={shown.viewer.liked}
              onClick={() => act('like', shown.viewer.liked)}
            />
            {me && shown.author_id === me.id && !repostRef && shown.viewer.can_edit && editing === null && (
              <ActionButton label="Editar" icon="edit" onClick={() => setEditing(shown.text)} />
            )}
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
    </>
  );
}
