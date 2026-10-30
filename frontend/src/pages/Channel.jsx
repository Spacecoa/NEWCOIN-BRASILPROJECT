import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import LoadError from '../components/LoadError.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { applyDifference, applyIncoming, mergeReactions } from '../lib/channelSync.js';
import { fullDate, relativeTime } from '../lib/time.js';

// Mesma lista que o servidor aceita (até 3 diferentes por pessoa em cada mensagem).
const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '🤔', '😮', '😢', '👏'];

/** Grupo é só para quem entrou; canal (transmissão) tem prévia para quem está logado. */
const canRead = (ch) => Boolean(ch && (ch.kind !== 'group' || ch.viewer_role));

export default function Channel() {
  const { slug } = useParams();
  const { user: me, socket } = useAuth();
  const [channel, setChannel] = useState(null);
  const [sync, setSync] = useState({ messages: [], lastPts: 0 });
  const [revealed, setRevealed] = useState(() => new Set());
  const [users, setUsers] = useState({});
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const syncRef = useRef(sync);
  const channelRef = useRef(null);
  channelRef.current = channel;
  syncRef.current = sync;
  const bottom = useRef(null);

  const addUsers = (list = []) => setUsers((prev) => ({ ...prev, ...Object.fromEntries(list.map((u) => [u.id, u])) }));

  const loadHistory = useCallback(async () => {
    const { data: ch } = await api(`/api/channels/${slug}`);
    if (!canRead(ch)) {
      setChannel(ch);
      setSync({ messages: [], lastPts: 0 });
      setHasOlder(false);
      return;
    }
    const history = await api(`/api/channels/${slug}/messages?max_results=50`);
    setChannel(ch);
    addUsers(history.includes.users);
    setSync({ messages: [...history.data].reverse(), lastPts: history.meta.pts });
    setHasOlder(Boolean(history.meta.next_token));
  }, [slug]);

  // Busca o que foi perdido desde o último pts conhecido (reconexão ou lacuna).
  const catchUp = useCallback(async () => {
    const diff = await api(`/api/channels/${slug}/difference?pts=${syncRef.current.lastPts}`);
    if (diff.meta.too_long) return loadHistory();
    addUsers(diff.includes.users);
    setSync((s) => applyDifference(s, diff.data, diff.meta.pts));
  }, [slug, loadHistory]);

  const receive = useCallback(
    (message) => {
      const { state, gap } = applyIncoming(syncRef.current, message);
      if (gap) return catchUp();
      syncRef.current = state;
      setSync(state);
    },
    [catchUp],
  );

  useEffect(() => {
    setChannel(null);
    setError(null);
    loadHistory().catch((e) => setError(e.message));
  }, [loadHistory]);

  const readable = canRead(channel);
  useEffect(() => {
    if (!socket || !readable) return;
    const subscribe = () =>
      socket.emitWithAck('channel:subscribe', { slug }).then((ack) => {
        if (ack.ok && ack.pts > syncRef.current.lastPts) catchUp();
      });
    const onMessage = (m) => {
      addUsers(m.includes.users);
      receive(m.data);
    };
    const onReactions = ({ message_id, reactions }) =>
      setSync((s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === message_id && !m.hidden ? { ...m, reactions: mergeReactions(m.reactions, reactions) } : m)),
      }));
    // Saiu do grupo ou foi removido por quem administra: some o histórico na hora.
    const onRemoved = ({ channel_id }) => {
      if (channel_id !== channelRef.current?.id) return;
      loadHistory().catch(() => {});
    };
    if (socket.connected) subscribe();
    socket.on('connect', subscribe); // reconexão => reinscreve e sincroniza por pts
    socket.on('message:new', onMessage);
    socket.on('message:reactions', onReactions);
    socket.on('channel:removed', onRemoved);
    return () => {
      socket.emit('channel:unsubscribe', { slug });
      socket.off('connect', subscribe);
      socket.off('message:new', onMessage);
      socket.off('message:reactions', onReactions);
      socket.off('channel:removed', onRemoved);
    };
  }, [socket, slug, receive, catchUp, readable, loadHistory]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [sync.messages.length]);

  async function loadOlder() {
    const oldest = sync.messages[0]?.id;
    const r = await api(`/api/channels/${slug}/messages?max_results=50&until_id=${oldest}`);
    addUsers(r.includes.users);
    setSync((s) => ({ ...s, messages: [...[...r.data].reverse(), ...s.messages] }));
    setHasOlder(Boolean(r.meta.next_token));
  }

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const m = await api(`/api/channels/${slug}/messages`, { method: 'POST', body: { text } });
      setText('');
      addUsers(m.includes.users);
      receive(m.data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function membership(join) {
    try {
      setError(null);
      await api(join ? `/api/channels/${slug}/members` : `/api/channels/${slug}/members/me`, { method: join ? 'POST' : 'DELETE' });
      await loadHistory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function react(message, emoji) {
    const mine = message.reactions.find((r) => r.emoji === emoji)?.reacted;
    const url = `/api/channels/${slug}/messages/${message.id}/reactions`;
    try {
      const { data } = await api(mine ? `${url}/${encodeURIComponent(emoji)}` : url, { method: mine ? 'DELETE' : 'POST', body: mine ? undefined : { emoji } });
      setSync((s) => ({ ...s, messages: s.messages.map((m) => (m.id === message.id ? { ...m, reactions: data.reactions } : m)) }));
    } catch (err) {
      setError(err.message);
    }
  }

  // Quem administra pode remover alguém; a pessoa não consegue entrar de novo.
  async function removePerson(username) {
    if (!window.confirm(`Remover @${username} deste espaço? A pessoa não conseguirá entrar de novo.`)) return;
    try {
      await api(`/api/channels/${slug}/members/${username}`, { method: 'DELETE' });
      setError(null);
      setNotice(`@${username} foi removido(a) e não pode entrar de novo.`);
      const { data } = await api(`/api/channels/${slug}`);
      setChannel(data);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !channel) return <LoadError message={error} onRetry={() => { setError(null); loadHistory().catch((e) => setError(e.message)); }} />;
  if (!channel) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const canPost = channel.viewer_role && (channel.kind === 'group' || channel.viewer_role !== 'member');
  const canModerate = ['owner', 'admin'].includes(channel.viewer_role);

  return (
    <div className="flex h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom,0px))] flex-col md:h-dvh">
      <PageHeader
        back
        title={channel.title}
        subtitle={`${channel.member_count} membros · sincronizado até pts ${sync.lastPts}`}
      >
        {channel.viewer_role !== 'owner' && (
          <button onClick={() => membership(!channel.viewer_role)} className="min-h-11 rounded-full bg-zinc-100 px-4 text-sm font-extrabold dark:bg-zinc-900">
            {channel.viewer_role ? 'Sair' : 'Entrar'}
          </button>
        )}
      </PageHeader>
      <ol className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Mensagens" aria-live="polite">
        {!readable && (
          <li className="rounded-3xl bg-zinc-50 p-5 text-center text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            Este grupo é só para quem entrou. Entre para ver e mandar mensagens.
          </li>
        )}
        {hasOlder && (
          <li className="text-center">
            <button onClick={loadOlder} className="text-sm text-brand-600 hover:underline">Carregar anteriores</button>
          </li>
        )}
        {sync.messages.map((m) => {
          // Bloqueio (qualquer lado) ou conta suspensa: o servidor não manda texto nem autor.
          if (m.hidden) {
            return (
              <li key={m.id} className="text-center">
                <span className="inline-block rounded-full bg-zinc-50 px-3 py-1 text-xs text-zinc-400 dark:bg-zinc-900">
                  {m.hidden === 'suspensa' ? 'Mensagem de uma conta suspensa' : 'Mensagem oculta por bloqueio'} · pts {m.pts}
                </span>
              </li>
            );
          }
          const author = users[m.author_id];
          const mine = m.author_id === me.id;
          // Silenciado: recolhido, com "Mostrar" (numa conversa, o contexto pode importar).
          if (m.muted && !revealed.has(m.id)) {
            return (
              <li key={m.id} className="flex items-center gap-2 text-xs text-zinc-400">
                <span>Mensagem de @{author?.username ?? '…'} (silenciada)</span>
                <button type="button" onClick={() => setRevealed((r) => new Set(r).add(m.id))} className="min-h-9 rounded-full px-3 font-extrabold text-brand-600">
                  Mostrar
                </button>
              </li>
            );
          }
          return (
            <li key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar user={author} size="sm" />
              <div className={`max-w-[80%] rounded-3xl px-4 py-2 ${mine ? 'rounded-br-lg bg-brand-600 text-white' : 'rounded-bl-lg bg-zinc-100 dark:bg-zinc-900'}`}>
                {!mine && (
                  <p className="flex items-center gap-2 text-xs font-extrabold text-zinc-500">
                    <span>{author?.display_name ?? '…'}</span>
                    {canModerate && author && (
                      <button type="button" onClick={() => removePerson(author.username)} className="font-normal underline opacity-70 hover:opacity-100">
                        Remover
                      </button>
                    )}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className={`mt-1 text-right text-[10px] ${mine ? 'text-brand-100' : 'text-zinc-500'}`} title={fullDate(m.created_at)}>
                  {relativeTime(m.created_at)} · pts {m.pts}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      onClick={() => react(m, r.emoji)}
                      aria-pressed={r.reacted}
                      className={`min-h-7 rounded-full px-2 text-xs ${r.reacted ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-500' : 'bg-white/80 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'}`}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                  {channel.viewer_role && (
                    <details className="relative">
                      <summary className="flex min-h-7 cursor-pointer list-none items-center rounded-full px-1.5 opacity-60 hover:opacity-100" aria-label="Reagir"><Icon name="smile" className="h-4 w-4" /></summary>
                      <div className="absolute z-10 mt-1 flex gap-1 rounded-full bg-white p-1 shadow dark:bg-zinc-800">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button key={emoji} onClick={() => react(m, emoji)} className="px-1">{emoji}</button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        <li ref={bottom} />
      </ol>
      {canPost ? (
        <form onSubmit={send} className="flex gap-2 px-3 py-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4096}
            placeholder="Mensagem"
            aria-label="Mensagem"
            className="min-h-11 min-w-0 flex-1 rounded-full bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
          />
          <button disabled={!text.trim()} className="min-h-11 rounded-full bg-brand-600 px-5 font-extrabold text-white disabled:opacity-40">Enviar</button>
        </form>
      ) : (
        <p className="p-3 text-center text-sm text-zinc-500">
          {channel.viewer_role ? 'Neste canal só administradores publicam.' : 'Entre para participar.'}
        </p>
      )}
      {notice && <p role="status" className="px-3 pb-2 text-sm text-zinc-600 dark:text-zinc-300">{notice}</p>}
      {error && <p role="alert" className="px-3 pb-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
