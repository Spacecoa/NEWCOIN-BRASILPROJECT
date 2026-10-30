import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.js';

// Contador de notificações não lidas, compartilhado entre a navegação e a tela de notificações.
let unread = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const unreadStore = {
  get: () => unread,
  set: (n) => {
    unread = Math.max(0, n);
    emit();
  },
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Lê o contador ao entrar e soma 1 a cada aviso que chega em tempo real. */
export function useUnreadNotifications(socket) {
  useEffect(() => {
    if (!socket) return undefined;
    api('/api/notificacoes/nao-lidas')
      .then((r) => unreadStore.set(r.unread_count))
      .catch(() => {});
    const onNotification = () => unreadStore.set(unread + 1);
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket]);
  return useSyncExternalStore(unreadStore.subscribe, unreadStore.get);
}

export const useUnreadCount = () => useSyncExternalStore(unreadStore.subscribe, unreadStore.get);

const VERB = {
  like: 'curtiu seu post',
  repost: 'repostou seu post',
  reply: 'respondeu você',
  mention: 'mencionou você',
  follow: 'começou a seguir você',
  tip: 'recompensou seu post com 1 NWC',
};
const VERB_MANY = {
  like: 'curtiram seu post',
  repost: 'repostaram seu post',
  follow: 'começaram a seguir você',
  tip: 'recompensaram seu post',
};

/**
 * Junta avisos seguidos do mesmo tipo sobre o mesmo post ("Ana e mais 2 curtiram seu post").
 * Respostas e menções nunca se juntam: cada uma é um post diferente, que vale ler.
 */
export function groupNotifications(items) {
  const groups = [];
  for (const n of items) {
    const last = groups.at(-1);
    if (last && VERB_MANY[n.kind] && last.kind === n.kind && last.post_id === n.post_id) {
      if (!last.actor_ids.includes(n.actor_id)) last.actor_ids.push(n.actor_id);
      last.read = last.read && n.read;
    } else {
      groups.push({ key: n.id, kind: n.kind, post_id: n.post_id, actor_ids: [n.actor_id], created_at: n.created_at, read: n.read });
    }
  }
  return groups;
}

/** "Ana curtiu seu post" · "Ana e Bruno curtiram…" · "Ana e mais 3 curtiram…" */
export function describeGroup(group, names) {
  const [first, second] = group.actor_ids.map((id) => names[id] ?? 'Alguém');
  const n = group.actor_ids.length;
  if (n === 1) return `${first} ${VERB[group.kind]}`;
  if (n === 2) return `${first} e ${second} ${VERB_MANY[group.kind]}`;
  return `${first} e mais ${n - 1} ${VERB_MANY[group.kind]}`;
}
