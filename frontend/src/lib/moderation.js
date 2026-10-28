import { api } from './api.js';

// Chamadas de moderação pessoal (silenciar, bloquear) e denúncias.
export const mute = (username, on = true) => api(`/api/users/${username}/mute`, { method: on ? 'POST' : 'DELETE' });
export const block = (username, on = true) => api(`/api/users/${username}/block`, { method: on ? 'POST' : 'DELETE' });
export const report = (body) => api('/api/denuncias', { method: 'POST', body });

let reasonsCache = null;
/** Motivos de denúncia vêm do servidor (uma lista só para app e API). */
export function loadReasons() {
  reasonsCache ??= api('/api/denuncias/motivos')
    .then((r) => r.data)
    .catch((err) => {
      reasonsCache = null;
      throw err;
    });
  return reasonsCache;
}

export const STATUS_LABEL = { aberta: 'Em análise', arquivada: 'Arquivada', acatada: 'Acatada' };
export const RESOLUTION_LABEL = {
  arquivar: 'A moderação não viu violação das regras.',
  remover_post: 'O post foi removido.',
  suspender: 'A conta foi suspensa.',
};
