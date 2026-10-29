import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { api, post, resetDb, signup } from './helpers.js';

// O algoritmo de cada pessoa fica só no aparelho dela. O servidor entrega os candidatos
// (test/device-mode.test.js) e guarda apenas o que não é do algoritmo.
describe('feed de interesses: o que o servidor ainda faz', () => {
  let ana, bruno;

  beforeEach(async () => {
    await resetDb();
    [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
  });

  it('não calcula mais o feed: a rota antiga avisa onde ele é calculado', async () => {
    expect((await api().get('/api/feed/interesses')).status).toBe(401);
    const res = await api().get('/api/feed/interesses').set(ana.auth);
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/aparelho/);
  });

  it('só aceita preferências que não são do algoritmo (missões e contagem de tempo)', async () => {
    const ok = await api().put('/api/feed/preferencias').set(ana.auth).send({ missions_enabled: false, count_time: false });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ missions_enabled: false, count_time: false, ranking_mode: 'device' });
    const algo = [{ weights: { interesse: 1 } }, { topics: { frontend: 1 } }, { keywords: ['x'] }, { session_limit: 10 }, { ranking_mode: 'server' }];
    for (const body of algo) expect((await api().put('/api/feed/preferencias').set(ana.auth).send(body)).status).toBe(400);
  });

  it('interações não ensinam nada ao servidor', async () => {
    const p = await post(bruno, 'Cache Redis na prática');
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    await post(ana, 'Concordo, Redis ajuda muito', p.id);
    const fb = await api().post(`/api/posts/${p.id}/feedback`).set(ana.auth).send({ kind: 'less' });
    expect(fb.body).toEqual({ ok: true, kind: 'less', stored: false });
    expect((await api().post(`/api/posts/${p.id}/feedback`).set(ana.auth).send({ kind: 'talvez' })).status).toBe(400);
    for (const t of ['learned_topics', 'learned_authors', 'hidden_posts']) {
      expect((await query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
    }
  });

  it('descrição do algoritmo é pública', async () => {
    const res = await api().get('/api/feed/algoritmo');
    expect(res.status).toBe(200);
    expect(res.body.codigo_fonte).toBe('shared/ranking/ranking.js');
    expect(res.body.learning.nao_usa).toContain('tempo de tela');
  });
});
