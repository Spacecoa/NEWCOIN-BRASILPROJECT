// Modo "neste aparelho": preferências, aprendizado e posts escondidos ficam SÓ no navegador.
// O ranking usa exatamente o mesmo código do servidor (shared/ranking/ranking.js).
import { decayed, learn, mergeSettings, rank } from '@shared/ranking/ranking.js';
import { extractTopics, TOPICS } from '@shared/ranking/topics.js';

const VERSION = 1;
const key = (userId) => `agora.algo.v${VERSION}.${userId}`;
// Preferências que não são do algoritmo continuam no servidor (afetam as missões).
export const SERVER_ONLY_KEYS = ['missions_enabled', 'count_time', 'ranking_mode'];

const memory = new Map(); // reserva quando o armazenamento do navegador não está disponível

const empty = () => ({ v: VERSION, settings: mergeSettings({}), learned: { topics: {}, authors: {} }, hidden: [] });

/** true se este aparelho já guarda um algoritmo desta conta. */
export function hasLocalState(userId) {
  try {
    return localStorage.getItem(key(userId)) !== null || memory.has(userId);
  } catch {
    return memory.has(userId);
  }
}

export function loadState(userId) {
  let raw;
  try {
    raw = localStorage.getItem(key(userId));
  } catch {
    // Armazenamento bloqueado (modo privado, política do navegador): vale só a memória desta aba.
    return memory.get(userId) ?? empty();
  }
  if (!raw) return empty(); // nada salvo (ou apagado pela pessoa): começa do zero
  try {
    const parsed = JSON.parse(raw);
    return { ...empty(), ...parsed, settings: mergeSettings(parsed.settings) };
  } catch {
    return empty(); // dado corrompido: não quebra o feed
  }
}

/** Apaga deste aparelho o algoritmo da conta (ex.: a conta foi excluída). */
export function forgetDevice(userId) {
  memory.delete(userId);
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* armazenamento indisponível: só havia a memória */
  }
}

function saveState(userId, state) {
  memory.set(userId, state);
  try {
    localStorage.setItem(key(userId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

const algorithmOnly = (settings) => Object.fromEntries(Object.entries(settings).filter(([k]) => !SERVER_ONLY_KEYS.includes(k)));

export function saveSettings(userId, patch) {
  const state = loadState(userId);
  state.settings = mergeSettings({
    ...state.settings,
    ...algorithmOnly(patch),
    weights: { ...state.settings.weights, ...(patch.weights ?? {}) },
    topics: patch.topics ? { ...state.settings.topics, ...patch.topics } : state.settings.topics,
  });
  saveState(userId, state);
  return state.settings;
}

/** Copia do servidor (antes de trocar de modo) as preferências, o aprendizado e os escondidos. */
export function importFromServer(userId, prefs) {
  const now = new Date().toISOString();
  const state = empty();
  state.settings = mergeSettings(algorithmOnly(prefs.settings ?? {}));
  for (const t of prefs.learned?.topics ?? []) state.learned.topics[t.topic] = { value: t.value, at: now };
  for (const a of prefs.learned?.authors ?? []) state.learned.authors[a.author_id] = { value: a.value, at: now, username: a.username };
  state.hidden = [...(prefs.hidden_post_ids ?? [])];
  saveState(userId, state);
  return state;
}

/** Aprende com um sinal explícito, igual ao servidor (mesma função learn()). */
export function learnLocal(userId, post, signal, username) {
  if (!post || post.author_id === userId) return;
  const state = loadState(userId);
  for (const topic of extractTopics(post.text ?? '')) {
    const cur = state.learned.topics[topic];
    state.learned.topics[topic] = { value: learn(cur?.value ?? 0, cur?.at ?? new Date(), signal), at: new Date().toISOString() };
  }
  const cur = state.learned.authors[post.author_id];
  state.learned.authors[post.author_id] = {
    value: learn(cur?.value ?? 0, cur?.at ?? new Date(), signal),
    at: new Date().toISOString(),
    username: username ?? cur?.username,
  };
  if (signal === 'less' && !state.hidden.includes(post.id)) state.hidden.push(post.id);
  saveState(userId, state);
}

export function resetLearning(userId) {
  const state = loadState(userId);
  state.learned = { topics: {}, authors: {} };
  state.hidden = [];
  saveState(userId, state);
}

const round = (x) => Math.round(x * 1000) / 1000;

/** Aprendizado com decaimento, no mesmo formato de GET /api/feed/preferencias. */
export function learnedView(userId) {
  const { learned } = loadState(userId);
  const topics = Object.entries(learned.topics)
    .map(([topic, e]) => ({ topic, label: TOPICS[topic]?.label ?? topic, value: round(decayed(e.value, e.at)) }))
    .filter((x) => Math.abs(x.value) >= 0.01)
    .sort((a, b) => b.value - a.value);
  const authors = Object.entries(learned.authors)
    .map(([author_id, e]) => ({ author_id, username: e.username ?? author_id, value: round(decayed(e.value, e.at)) }))
    .filter((x) => Math.abs(x.value) >= 0.01)
    .sort((a, b) => b.value - a.value);
  return { topics, authors };
}

/** Ordena localmente os candidatos de GET /api/feed/candidatos. */
export function rankLocally(userId, candidates) {
  const { settings, hidden } = loadState(userId);
  const view = learnedView(userId);
  const hiddenSet = new Set(hidden);
  const rows = candidates.data
    .filter((p) => !hiddenSet.has(p.id))
    .map((p) => ({ id: p.id, author_id: p.author_id, text: p.text, created_at: p.created_at, like_count: p.public_metrics.like_count, repost_count: p.public_metrics.repost_count }));
  const ranked = rank(rows, {
    settings,
    following: new Set(candidates.meta.following),
    learnedTopics: Object.fromEntries(view.topics.map((t) => [t.topic, t.value])),
    learnedAuthors: Object.fromEntries(view.authors.map((a) => [a.author_id, a.value])),
  });
  const personalized = Object.values(settings.topics).some((v) => v > 0) || settings.keywords.length > 0 || view.topics.some((t) => t.value > 0);
  return { ranked, settings, personalized };
}

/**
 * Fonte de dados do <Feed> no modo aparelho: baixa os candidatos uma vez, ordena aqui
 * e entrega páginas no mesmo formato da API do servidor (data, includes, meta).
 */
export function createDeviceSource(userId, fetchCandidates) {
  let cache = null;
  return async (cursor, limit) => {
    if (!cache || cursor == null) {
      const candidates = await fetchCandidates();
      const byId = new Map(candidates.data.map((p) => [p.id, p]));
      const { ranked, settings, personalized } = rankLocally(userId, candidates);
      cache = { candidates, byId, ranked, settings, personalized };
    }
    const offset = cursor == null ? 0 : Number(cursor);
    const page = cache.ranked.slice(offset, offset + limit);
    const end = offset + page.length;
    const caughtUp = end >= cache.ranked.length;
    return {
      data: page.map((r, i) => ({
        ...cache.byId.get(r.post.id),
        ranking: {
          position: offset + i + 1,
          score: r.score,
          topics: r.topics.map((t) => ({ id: t, label: TOPICS[t].label })),
          keywords: r.keywords,
          reasons: r.reasons,
          local: true,
        },
      })),
      includes: cache.candidates.includes,
      meta: {
        result_count: page.length,
        next_token: caughtUp ? undefined : String(end),
        caught_up: caughtUp,
        session: { limit: cache.settings.session_limit, delivered: end, available: cache.ranked.length },
        hide_metrics: cache.settings.hide_metrics,
        personalized: cache.personalized,
        mode: 'device',
      },
    };
  };
}
