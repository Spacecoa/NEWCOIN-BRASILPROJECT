import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { applyDifference, applyIncoming, mergeReactions } from '../lib/channelSync.js';
import { fullDate, relativeTime } from '../lib/time.js';

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '🤔'];

export default function Channel() {
  const { slug } = useParams();
  const { user: me, socket } = useAuth();
  const [channel, setChannel] = useState(null);
  const [sync, setSync] = useState({ messages: [], lastPts: 0 });
  const [users, setUsers] = useState({});
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const bottom = useRef(null);

  const addUsers = (list = []) => setUsers((prev) => ({ ...prev, ...Object.fromEntries(list.map((u) => [u.id, u])) }));

  const loadHistory = useCallback(async () => {
    const [{ data: ch }, history] = await Promise.all([
      api(`/api/channels/${slug}`),
      api(`/api/channels/${slug}/messages?max_results=50`),
    ]);
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

  useEffect(() => {
    if (!socket) return;
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
        messages: s.messages.map((m) => (m.id === message_id ? { ...m, reactions: mergeReactions(m.reactions, reactions) } : m)),
      }));
    if (socket.connected) subscribe();
    socket.on('connect', subscribe); // reconexão => reinscreve e sincroniza por pts
    socket.on('message:new', onMessage);
    socket.on('message:reactions', onReactions);
    return () => {
      socket.emit('channel:unsubscribe', { slug });
      socket.off('connect', subscribe);
      socket.off('message:new', onMessage);
      socket.off('message:reactions', onReactions);
    };
  }, [socket, slug, receive, catchUp]);

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
    const { data } = await api(join ? `/api/channels/${slug}/members` : `/api/channels/${slug}/members/me`, { method: join ? 'POST' : 'DELETE' });
    setChannel(data);
  }

  async function react(message, emoji) {
    const mine = message.reactions.find((r) => r.emoji === emoji)?.reacted;
    const url = `/api/channels/${slug}/messages/${message.id}/reactions`;
    const { data } = await api(mine ? `${url}/${encodeURIComponent(emoji)}` : url, { method: mine ? 'DELETE' : 'POST', body: mine ? undefined : { emoji } });
    setSync((s) => ({ ...s, messages: s.messages.map((m) => (m.id === message.id ? { ...m, reactions: data.reactions } : m)) }));
  }

  if (error && !channel) return <p className="p-8 text-center text-zinc-500">{error}</p>;
  if (!channel) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const canPost = channel.viewer_role && (channel.kind === 'group' || channel.viewer_role !== 'member');

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col sm:h-screen">
      <PageHeader
        title={`${channel.kind === 'channel' ? '📣' : '💬'} ${channel.title}`}
        subtitle={`${channel.member_count} membros · sincronizado até pts ${sync.lastPts}`}
      >
        {channel.viewer_role !== 'owner' && (
          <button onClick={() => membership(!channel.viewer_role)} className="rounded-full border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700">
            {channel.viewer_role ? 'Sair' : 'Entrar'}
          </button>
        )}
      </PageHeader>
      <ol className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Mensagens" aria-live="polite">
        {hasOlder && (
          <li className="text-center">
            <button onClick={loadOlder} className="text-sm text-brand-600 hover:underline">Carregar anteriores</button>
          </li>
        )}
        {sync.messages.map((m) => {
          const author = users[m.author_id];
          const mine = m.author_id === me.id;
          return (
            <li key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar user={author} size="sm" />
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-brand-600 text-white' : 'bg-zinc-100 dark:bg-zinc-900'}`}>
                <p className={`text-xs font-semibold ${mine ? 'text-brand-100' : 'text-brand-600'}`}>{author?.display_name ?? '…'}</p>
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
                      className={`rounded-full px-2 text-xs ${r.reacted ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-500' : 'bg-white/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'}`}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                  {channel.viewer_role && (
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-full px-1.5 text-xs opacity-60 hover:opacity-100" aria-label="Reagir">＋</summary>
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
        <form onSubmit={send} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4096}
            placeholder="Mensagem"
            aria-label="Mensagem"
            className="flex-1 rounded-full bg-zinc-100 px-4 py-2 outline-none dark:bg-zinc-900"
          />
          <button disabled={!text.trim()} className="rounded-full bg-brand-600 px-4 font-semibold text-white disabled:opacity-50">Enviar</button>
        </form>
      ) : (
        <p className="border-t border-zinc-200 p-3 text-center text-sm text-zinc-500 dark:border-zinc-800">
          {channel.viewer_role ? 'Neste canal só administradores publicam.' : 'Entre para participar.'}
        </p>
      )}
      {error && <p role="alert" className="px-3 pb-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
