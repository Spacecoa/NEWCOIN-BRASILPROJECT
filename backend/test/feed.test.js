import { beforeEach, describe, expect, it } from 'vitest';
import { api, post, resetDb, signup } from './helpers.js';

describe('feed de interesses (algoritmo aberto)', () => {
  let ana, bruno, carla;
  const feed = (who, qs = '') => api().get(`/api/feed/interesses${qs}`).set(who.auth);

  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('exige login, exclui próprios posts e reposts, e explica cada item', async () => {
    expect((await api().get('/api/feed/interesses')).status).toBe(401);
    const b = await post(bruno, 'Postgres com índices parciais');
    await post(ana, 'meu próprio post sobre Postgres');
    await api().post(`/api/posts/${b.id}/repost`).set(carla.auth);
    const res = await feed(ana);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id)).toEqual([b.id]);
    const { ranking } = res.body.data[0];
    expect(ranking.position).toBe(1);
    expect(ranking.topics).toEqual([{ id: 'bancos', label: 'Bancos de dados' }]);
    expect(ranking.reasons.map((r) => r.fator).sort()).toEqual(['descoberta', 'interesse', 'pessoas', 'popularidade', 'recencia']);
    expect(res.body.meta).toMatchObject({ caught_up: true, algorithm: 'interesses-v1', hide_metrics: false, personalized: false });
  });

  it('preferências declaradas reordenam o feed', async () => {
    await post(bruno, 'Componente React acessível');
    await post(carla, 'Deploy no Kubernetes');
    let res = await feed(ana);
    const before = res.body.data.map((p) => p.text);
    expect(before[0]).toBe('Deploy no Kubernetes'); // empate: o mais recente vem primeiro

    const put = await api().put('/api/feed/preferencias').set(ana.auth).send({ topics: { frontend: 1 } });
    expect(put.status).toBe(200);
    res = await feed(ana);
    expect(res.body.meta.personalized).toBe(true);
    expect(res.body.data[0].text).toBe('Componente React acessível');
    expect(res.body.data[0].ranking.reasons[0]).toMatchObject({ fator: 'interesse', valor: 1 });
  });

  it('palavras-chave e tópicos silenciados', async () => {
    await post(bruno, 'Estou estudando WebAssembly');
    await post(carla, 'Alerta de disco no servidor');
    await api().put('/api/feed/preferencias').set(ana.auth).send({ keywords: ['webassembly'], muted_topics: ['infra'] });
    const res = await feed(ana);
    expect(res.body.data.map((p) => p.text)).toEqual(['Estou estudando WebAssembly']);
    expect(res.body.data[0].ranking.keywords).toEqual(['webassembly']);
  });

  it('valida preferências e rejeita campos desconhecidos', async () => {
    const bad = [{ weights: { interesse: 2 } }, { topics: { inexistente: 1 } }, { session_limit: 1 }, { tempo_de_tela: true }];
    for (const body of bad) expect((await api().put('/api/feed/preferencias').set(ana.auth).send(body)).status).toBe(400);
  });

  it('curtir ensina tópico e autor; "menos disto" esconde o post e reduz a afinidade', async () => {
    const p = await post(bruno, 'Cache Redis na prática');
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    let prefs = await api().get('/api/feed/preferencias').set(ana.auth);
    expect(prefs.body.learned.topics).toEqual([{ topic: 'bancos', label: 'Bancos de dados', value: 0.15 }]);
    expect(prefs.body.learned.authors[0]).toMatchObject({ username: 'bruno', value: 0.15 });

    const fb = await api().post(`/api/posts/${p.id}/feedback`).set(ana.auth).send({ kind: 'less' });
    expect(fb.status).toBe(200);
    expect((await feed(ana)).body.data).toHaveLength(0);
    prefs = await api().get('/api/feed/preferencias').set(ana.auth);
    expect(prefs.body.learned.topics[0].value).toBeCloseTo(-0.35);

    expect((await api().post(`/api/posts/${p.id}/feedback`).set(ana.auth).send({ kind: 'talvez' })).status).toBe(400);

    await api().delete('/api/feed/aprendizado').set(ana.auth);
    prefs = await api().get('/api/feed/preferencias').set(ana.auth);
    expect(prefs.body.learned).toEqual({ topics: [], authors: [] });
    expect((await feed(ana)).body.data).toHaveLength(1);
  });

  it('responder ensina; interagir com o próprio post não', async () => {
    const p = await post(bruno, 'Aula sobre federação amanhã');
    await post(ana, 'Vou assistir!', p.id);
    const mine = await post(ana, 'meu post de React');
    await api().post(`/api/posts/${mine.id}/like`).set(ana.auth);
    const prefs = await api().get('/api/feed/preferencias').set(ana.auth);
    expect(prefs.body.learned.topics.map((t) => t.topic).sort()).toEqual(['ensino', 'federacao']);
  });

  it('tem fim: limite da sessão, paginação sem repetição e caught_up', async () => {
    for (let i = 0; i < 7; i++) await post(i % 2 ? bruno : carla, `post ${i} sobre Postgres`);
    await api().put('/api/feed/preferencias').set(ana.auth).send({ session_limit: 5 });
    const p1 = await feed(ana, '?max_results=3');
    expect(p1.body.meta).toMatchObject({ caught_up: false, next_token: '3', session: { limit: 5, delivered: 3, available: 5 } });
    const p2 = await feed(ana, `?max_results=3&next_token=${p1.body.meta.next_token}`);
    expect(p2.body.meta).toMatchObject({ caught_up: true, session: { delivered: 5 } });
    expect(p2.body.meta.next_token).toBeUndefined();
    const ids = [...p1.body.data, ...p2.body.data].map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('descrição do algoritmo é pública', async () => {
    const res = await api().get('/api/feed/algoritmo');
    expect(res.status).toBe(200);
    expect(res.body.codigo_fonte).toBe('backend/src/lib/ranking.js');
    expect(res.body.learning.nao_usa).toContain('tempo de tela');
  });
});
