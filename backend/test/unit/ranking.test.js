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
