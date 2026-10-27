import { describe, expect, it } from 'vitest';
import { decayed, describeAlgorithm, diversify, learn, mergeSettings, rank, scorePost, similarity, topicWeight } from '../../src/lib/ranking.js';
import { extractTopics, matchKeywords } from '../../src/lib/topics.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
let seq = 1000;
const post = (o) => ({ id: String(seq++), author_id: '9', text: 'texto neutro', created_at: hoursAgo(1), like_count: 0, repost_count: 0, ...o });
const ctx = (settings = {}, extra = {}) => ({ settings: mergeSettings(settings), following: new Set(), now: NOW, ...extra });

describe('tópicos', () => {
  it('ignora acentos e casa no começo da palavra', () => {
    expect(extractTopics('Consistência em Banco de Dados com transações')).toEqual(['bancos', 'distribuidos']);
    expect(extractTopics('Bom dia! Café passado')).toEqual(['cotidiano']);
    expect(extractTopics('nada a ver')).toEqual([]);
  });
  it('palavras-chave livres do usuário', () => {
    expect(matchKeywords('Testei WebAssembly hoje', ['webassembly', 'rust'])).toEqual(['webassembly']);
    expect(matchKeywords('qualquer', [])).toEqual([]);
  });
});

describe('scorePost', () => {
  it('score fica em [0, 1] e é a soma das contribuições', () => {
    const r = scorePost(post({ text: 'Postgres e Redis', like_count: 10 }), ctx({ topics: { bancos: 1 }, weights: { popularidade: 0.3 } }, { following: new Set(['9']) }));
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
    const sum = r.reasons.reduce((s, x) => s + x.contribuicao, 0);
    expect(Math.abs(sum - r.score)).toBeLessThan(0.005);
    expect(r.reasons[0].contribuicao).toBeGreaterThanOrEqual(r.reasons.at(-1).contribuicao);
  });

  it('popularidade vale zero por padrão: curtidas de outros não mudam o score', () => {
    const a = scorePost(post({ like_count: 0 }), ctx());
    const b = scorePost(post({ like_count: 5000, repost_count: 900 }), ctx());
    expect(a.score).toBe(b.score);
  });

  it('recência cai pela metade a cada meia-vida', () => {
    const r = scorePost(post({ created_at: hoursAgo(24) }), ctx({ weights: { interesse: 0, pessoas: 0, descoberta: 0, recencia: 1 } }));
    expect(r.score).toBeCloseTo(0.5, 2);
  });

  it('tópico silenciado exclui o post', () => {
    expect(scorePost(post({ text: 'deploy no kubernetes' }), ctx({ muted_topics: ['infra'] }))).toBeNull();
  });

  it('palavra-chave do usuário dá interesse máximo e aparece na explicação', () => {
    const r = scorePost(post({ text: 'Novidades de WebAssembly' }), ctx({ keywords: ['webassembly'] }));
    const interesse = r.reasons.find((x) => x.fator === 'interesse');
    expect(interesse.valor).toBe(1);
    expect(interesse.detalhe).toContain('webassembly');
  });

  it('descoberta só conta para autor novo E post relevante', () => {
    const relevant = scorePost(post({ text: 'Postgres' }), ctx({ topics: { bancos: 0.8 } }));
    const irrelevant = scorePost(post({ text: 'nada' }), ctx({ topics: { bancos: 0.8 } }));
    const followed = scorePost(post({ text: 'Postgres' }), ctx({ topics: { bancos: 0.8 } }, { following: new Set(['9']) }));
    const val = (r) => r.reasons.find((x) => x.fator === 'descoberta').valor;
    expect([val(relevant), val(irrelevant), val(followed)]).toEqual([1, 0, 0]);
  });
});

describe('aprendizado', () => {
  it('declarado domina: aprendido vale no máximo metade', () => {
    const s = mergeSettings({ topics: { bancos: 0.2 } });
    expect(topicWeight('bancos', s, { bancos: 1 })).toBeCloseTo(0.7);
    expect(topicWeight('bancos', s, { bancos: -1 })).toBe(0);
    expect(topicWeight('frontend', s, {})).toBe(0);
  });
  it('decai pela metade a cada 14 dias e fica em [-1, 1]', () => {
    const t0 = new Date(NOW - 14 * 86_400_000);
    expect(decayed(0.8, t0, NOW)).toBeCloseTo(0.4);
    let v = 0;
    for (let i = 0; i < 20; i++) v = learn(v, new Date(NOW), 'reply', NOW);
    expect(v).toBe(1);
    expect(learn(-0.9, new Date(NOW), 'less', NOW)).toBe(-1);
    expect(() => learn(0, new Date(), 'tempo_de_tela')).toThrow();
  });
});

describe('diversidade (MMR)', () => {
  it('quebra sequências do mesmo autor', () => {
    const items = [
      ...[0.9, 0.89, 0.88, 0.87].map((score, i) => ({ score, topics: ['bancos'], post: { id: String(10 + i), author_id: 'A' } })),
      { score: 0.6, topics: ['frontend'], post: { id: '20', author_id: 'B' } },
      { score: 0.55, topics: ['ensino'], post: { id: '21', author_id: 'C' } },
    ];
    const noDiv = diversify(items, 0).map((x) => x.post.author_id);
    const div = diversify(items, 0.5).map((x) => x.post.author_id);
    expect(noDiv.slice(0, 4)).toEqual(['A', 'A', 'A', 'A']);
    expect(div.slice(0, 3)).toEqual(['A', 'B', 'C']);
    expect(similarity(items[0], items[1])).toBe(1);
    expect(similarity(items[4], items[5])).toBe(0);
  });

  it('rank aplica o limite da sessão', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post({ author_id: String(i) }));
    expect(rank(posts, ctx({ session_limit: 7 }))).toHaveLength(7);
  });
});

describe('transparência', () => {
  it('descreve fatores, sinais e o que NÃO é usado', () => {
    const d = describeAlgorithm();
    expect(d.factors.map((f) => f.id)).toEqual(['interesse', 'pessoas', 'recencia', 'descoberta', 'popularidade']);
    expect(d.learning.nao_usa).toContain('tempo de tela');
    expect(d.defaults.weights.popularidade).toBe(0);
  });
});

// Versão original do MMR (sem limite e sem pré-cálculo), guardada para provar que a otimização
// não muda o resultado.
function diversifyReferencia(items, lambda, window = 5) {
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

describe('desempenho do MMR sem mudar o resultado', () => {
  // gerador pseudoaleatório determinístico
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const TOPICOS = ['bancos', 'frontend', 'redes', 'infra', 'ensino', 'dados'];

  it('é idêntico à versão completa cortada no limite, em 300 casos aleatórios (com empates)', () => {
    for (let c = 0; c < 300; c++) {
      const n = 1 + Math.floor(rnd() * 80);
      const items = Array.from({ length: n }, (_, i) => ({
        score: Math.round(rnd() * 10) / 10, // muitos empates de nota
        topics: TOPICOS.filter(() => rnd() < 0.3),
        post: { id: String(1000 + Math.floor(rnd() * 5000) * 10 + i), author_id: String(Math.floor(rnd() * 6)) },
      }));
      const lambda = [0, 0.3, 0.5, 1][c % 4];
      const limit = 1 + Math.floor(rnd() * n);
      const novo = diversify(items, lambda, 5, limit).map((x) => x.post.id);
      const ref = diversifyReferencia(items, lambda).slice(0, limit).map((x) => x.post.id);
      expect(novo).toEqual(ref);
    }
  });

  it('rank() com 500 candidatos fica bem abaixo de 50 ms de CPU', () => {
    const posts = Array.from({ length: 500 }, (_, i) => post({ author_id: String(i % 97), text: ['Postgres e cache', 'React e CSS', 'Deploy no Kubernetes', 'Aula de sexta', 'WebFinger e federação'][i % 5] + ' ' + i, created_at: hoursAgo(i % 100) }));
    const c = ctx({ topics: { bancos: 0.8 }, keywords: ['webfinger'] });
    rank(posts, c);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) rank(posts, c);
    expect((performance.now() - t0) / 5).toBeLessThan(50);
  });
});

