// Algoritmo de atenção ABERTO do Ágora ("Interesses").
//
// Princípios (ver docs/07-atencao-e-algoritmo-aberto.md):
//  1. O que o usuário DECLARA vale mais do que o que o sistema INFERE.
//  2. Só ações explícitas ensinam o algoritmo (curtir, repostar, responder,
//     "mais disto", "menos disto"). Nada de tempo de tela ou rastreio passivo.
//  3. Popularidade (curtidas de outras pessoas) vale ZERO por padrão: o feed
//     não premia o que viraliza, premia o que interessa a você.
//  4. Todo item vem com a explicação numérica de por que está ali.
//  5. O feed tem fim: um limite por sessão e a mensagem "Você está em dia".
//  6. Diversidade obrigatória: evita sequências do mesmo autor ou tema.
//
// Este arquivo é puro (sem banco, sem Node, sem DOM), para ser lido, testado e auditado
// isoladamente, e roda igual no servidor e no navegador (modo "neste aparelho").

import { extractTopics, matchKeywords, TOPICS } from './topics.js';

export const ALGORITHM_VERSION = 'interesses-v1';

export const FACTORS = {
  interesse: 'Combina com seus tópicos e palavras-chave',
  pessoas: 'Vem de quem você segue ou com quem interage',
  recencia: 'É recente',
  descoberta: 'Pessoa nova, mas no seu tema',
  popularidade: 'Muitas curtidas e reposts',
};

export const DEFAULT_SETTINGS = Object.freeze({
  weights: { interesse: 0.45, pessoas: 0.25, recencia: 0.2, descoberta: 0.1, popularidade: 0 },
  topics: {}, // { [topicId]: 0..1 } pesos declarados pelo usuário
  muted_topics: [], // tópicos que nunca aparecem
  keywords: [], // linhas de interesse livres ("webassembly", "ciclovia"...)
  half_life_hours: 24, // a cada N horas, a recência vale metade
  diversity: 0.5, // 0 = sem penalidade, 1 = máxima variedade
  session_limit: 40, // depois disso: "Você está em dia"
  hide_metrics: false, // esconder contadores no feed de interesses
  missions_enabled: true, // mostrar as missões diárias (ver lib/missions.js)
  count_time: true, // contar minutos ativos no app para a missão de tempo (nunca usado no ranking)
  ranking_mode: 'server', // 'server' = a instância calcula; 'device' = o navegador calcula e guarda as preferências
});

export const LEARNING = Object.freeze({
  signals: { like: 0.15, unlike: -0.15, repost: 0.25, reply: 0.3, more: 0.3, less: -0.5 },
  half_life_days: 14, // o que foi aprendido perde metade da força a cada 14 dias
  learned_share: 0.5, // aprendizado vale no máximo metade de um peso declarado
});

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Valor aprendido com decaimento exponencial pelo tempo desde a última atualização. */
export function decayed(value, updatedAt, now = Date.now()) {
  const days = Math.max(0, (now - new Date(updatedAt).getTime()) / 86_400_000);
  return value * 0.5 ** (days / LEARNING.half_life_days);
}

/** Novo valor aprendido após um sinal explícito, limitado a [-1, 1]. */
export function learn(current, updatedAt, signal, now = Date.now()) {
  const delta = LEARNING.signals[signal];
  if (delta === undefined) throw new Error(`sinal desconhecido: ${signal}`);
  return clamp((current ? decayed(current, updatedAt, now) : 0) + delta, -1, 1);
}

/** Peso efetivo de um tópico = declarado + parte do aprendido. */
export function topicWeight(topic, settings, learnedTopics = {}) {
  const declared = settings.topics?.[topic] ?? 0;
  return clamp(declared + LEARNING.learned_share * (learnedTopics[topic] ?? 0));
}

export function mergeSettings(saved = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    weights: { ...DEFAULT_SETTINGS.weights, ...(saved.weights ?? {}) },
    topics: { ...(saved.topics ?? {}) },
  };
}

/**
 * Pontua um post candidato.
 * ctx = { settings, following:Set, learnedTopics:{t:v}, learnedAuthors:{id:v}, now }
 * Retorna null se o post deve ser excluído (tópico silenciado).
 */
export function scorePost(post, ctx) {
  const { settings, following, learnedTopics = {}, learnedAuthors = {}, now = Date.now() } = ctx;
  const topics = extractTopics(post.text);
  if (topics.some((t) => settings.muted_topics.includes(t))) return null;
  const keywordHits = matchKeywords(post.text, settings.keywords);

  // interesse: o melhor sinal entre tópicos (peso efetivo) e palavras-chave (peso 1)
  const topicScores = topics.map((t) => ({ t, w: topicWeight(t, settings, learnedTopics) }));
  const bestTopic = topicScores.reduce((a, b) => (b.w > (a?.w ?? -1) ? b : a), null);
  const interesse = keywordHits.length ? 1 : bestTopic?.w ?? 0;

  const follows = following.has(post.author_id);
  const authorAffinity = clamp(learnedAuthors[post.author_id] ?? 0);
  const pessoas = follows ? 1 : 0.6 * authorAffinity;

  const ageHours = Math.max(0, (now - new Date(post.created_at).getTime()) / 3_600_000);
  const recencia = 0.5 ** (ageHours / settings.half_life_hours);

  // descoberta só conta quando o post é relevante (interesse >= 0.3) e o autor é novo
  const descoberta = !follows && authorAffinity === 0 && interesse >= 0.3 ? 1 : 0;

  const engajamento = (post.like_count ?? 0) + (post.repost_count ?? 0);
  const popularidade = clamp(Math.log1p(engajamento) / Math.log1p(50));

  const features = { interesse, pessoas, recencia, descoberta, popularidade };
  const totalWeight = Object.values(settings.weights).reduce((a, b) => a + b, 0) || 1;
  const reasons = Object.entries(features).map(([fator, valor]) => ({
    fator,
    valor: round(valor),
    peso: round(settings.weights[fator] / totalWeight),
    contribuicao: round((settings.weights[fator] * valor) / totalWeight),
    detalhe: detail(fator, { valor, topics, bestTopic, keywordHits, follows, authorAffinity, ageHours, engajamento }),
  }));
  const score = round(reasons.reduce((s, r) => s + (settings.weights[r.fator] * features[r.fator]) / totalWeight, 0));
  return { score, topics, keywords: keywordHits, reasons: reasons.sort((a, b) => b.contribuicao - a.contribuicao) };
}

function detail(fator, d) {
  switch (fator) {
    case 'interesse':
      if (d.keywordHits.length) return `Sua palavra-chave: ${d.keywordHits.map((k) => `"${k}"`).join(', ')}`;
      if (d.bestTopic) return `Tópico ${TOPICS[d.bestTopic.t].label} (peso ${Math.round(d.bestTopic.w * 100)}%)`;
      return 'Sem tópicos ou palavras-chave suas';
    case 'pessoas':
      if (d.follows) return 'Você segue esta pessoa';
      if (d.authorAffinity > 0) return 'Você já interagiu com esta pessoa';
      return 'Você não segue esta pessoa';
    case 'recencia':
      return d.ageHours < 1 ? 'Publicado há menos de 1 h' : `Publicado há ${Math.round(d.ageHours)} h`;
    case 'descoberta':
      return d.valor ? 'Pessoa nova falando de algo que você curte' : 'Não se aplica';
    case 'popularidade':
      return `${d.engajamento} curtidas e reposts`;
    default:
      return '';
  }
}

const round = (x) => Math.round(x * 1000) / 1000;

/** Similaridade entre dois itens já pontuados: mesmo autor = 1; senão, Jaccard dos tópicos. */
export function similarity(a, b) {
  if (a.post.author_id === b.post.author_id) return 1;
  const A = new Set(a.topics);
  const B = new Set(b.topics);
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / (A.size + B.size - inter);
}

/**
 * Reordena por relevância com penalidade de redundância (Maximal Marginal Relevance):
 * a cada passo escolhe o item que maximiza score − λ · (similaridade máxima com os 5 últimos escolhidos).
 */
export function diversify(items, lambda, window = 5) {
  const pool = [...items];
  const out = [];
  while (pool.length) {
    let best = 0;
    let bestVal = -Infinity;
    const recent = out.slice(-window);
    for (let i = 0; i < pool.length; i++) {
      const penalty = recent.length ? Math.max(...recent.map((r) => similarity(pool[i], r))) : 0;
      const val = pool[i].score - lambda * penalty;
      if (val > bestVal || (val === bestVal && BigInt(pool[i].post.id) > BigInt(pool[best].post.id))) {
        best = i;
        bestVal = val;
      }
    }
    out.push(pool.splice(best, 1)[0]);
  }
  return out;
}

/** Pipeline completo: pontua, exclui, ordena, diversifica e aplica o limite da sessão. */
export function rank(posts, ctx) {
  const scored = [];
  for (const post of posts) {
    const r = scorePost(post, ctx);
    if (r) scored.push({ post, ...r });
  }
  scored.sort((a, b) => b.score - a.score || (BigInt(b.post.id) > BigInt(a.post.id) ? 1 : -1));
  return diversify(scored, ctx.settings.diversity).slice(0, ctx.settings.session_limit);
}

/** Descrição pública do algoritmo (servida em GET /api/feed/algoritmo). */
export function describeAlgorithm() {
  return {
    version: ALGORITHM_VERSION,
    formula: 'score = Σ (peso_fator × valor_fator) / Σ pesos; depois MMR: score − diversidade × similaridade_máxima(5 últimos)',
    factors: Object.entries(FACTORS).map(([id, descricao]) => ({ id, descricao, peso_padrao: DEFAULT_SETTINGS.weights[id] })),
    learning: {
      sinais: LEARNING.signals,
      meia_vida_dias: LEARNING.half_life_days,
      fracao_maxima_do_aprendido: LEARNING.learned_share,
      nao_usa: ['tempo de tela', 'rolagem', 'visualizações', 'localização', 'contatos'],
    },
    defaults: DEFAULT_SETTINGS,
    topics: Object.fromEntries(Object.entries(TOPICS).map(([id, t]) => [id, t])),
    exclusions: ['seus próprios posts', 'reposts (o original pode aparecer)', 'tópicos silenciados', 'posts marcados com "menos disto"'],
    candidates: 'posts originais e respostas dos últimos 7 dias (até 500)',
    codigo_fonte: 'shared/ranking/ranking.js',
    modos: {
      servidor: 'a instância calcula o feed com as preferências guardadas nela',
      aparelho: 'o navegador baixa os candidatos e calcula o feed; preferências e aprendizado ficam só no aparelho',
    },
  };
}
