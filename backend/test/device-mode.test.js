import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { decayed, mergeSettings, rank } from '../../shared/ranking/ranking.js';
import { api, post, resetDb, signup } from './helpers.js';

const candidatos = (who) => api().get('/api/feed/candidatos').set(who.auth);
const prefs = async (who) => (await api().get('/api/feed/preferencias').set(who.auth)).body;
const setMode = (who, mode) => api().put('/api/feed/modo').set(who.auth).send({ mode });

/** Faz no "navegador" o mesmo que o servidor faz: rank() sobre os candidatos. */
function rankOnDevice(body, settings, learned = { topics: [], authors: [] }) {
  const rows = body.data.map((p) => ({
    id: p.id,
    author_id: p.author_id,
    text: p.text,
    created_at: p.created_at,
    like_count: p.public_metrics.like_count,
    repost_count: p.public_metrics.repost_count,
  }));
  return rank(rows, {
    settings: mergeSettings(settings),
    following: new Set(body.meta.following),
    learnedTopics: Object.fromEntries(learned.topics.map((t) => [t.topic, t.value])),
    learnedAuthors: Object.fromEntries(learned.authors.map((a) => [a.author_id, a.value])),
  }).map((r) => r.post.id);
}

describe('ranking neste aparelho', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('candidatos: exige login, exclui próprios posts e reposts, traz quem a pessoa segue e o estado do viewer', async () => {
    expect((await api().get('/api/feed/candidatos')).status).toBe(401);
    const b = await post(bruno, 'Postgres e Redis');
    const c = await post(carla, 'React e CSS');
    await post(ana, 'meu post');
    await api().post(`/api/posts/${b.id}/repost`).set(carla.auth);
    await api().post(`/api/posts/${c.id}/like`).set(ana.auth);
    await api().post('/api/users/bruno/follow').set(ana.auth);

    const res = await candidatos(ana);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id).sort()).toEqual([b.id, c.id].sort());
    expect(res.body.data.find((p) => p.id === c.id).viewer.liked).toBe(true);
    expect(res.body.meta).toMatchObject({ following: [bruno.user.id], window_days: 7, limit: 500, algorithm: 'interesses-v1' });
    expect(res.body.includes.users.map((u) => u.username).sort()).toEqual(['bruno', 'carla']);
  });

  it('o conjunto de candidatos não depende das preferências (não revela gostos à instância)', async () => {
    for (let i = 0; i < 4; i++) await post(i % 2 ? bruno : carla, `post ${i} sobre ${i % 2 ? 'Postgres' : 'React'}`);
    const before = (await candidatos(ana)).body.data.map((p) => p.id);
    await api().put('/api/feed/preferencias').set(ana.auth).send({ topics: { frontend: 1 }, muted_topics: ['bancos'], keywords: ['react'] });
    const after = (await candidatos(ana)).body.data.map((p) => p.id);
    expect(after).toEqual(before);
  });

  it('mesma entrada, mesma ordem: rank() no aparelho reproduz o feed do servidor', async () => {
    const texts = ['Postgres com índices', 'Componente React acessível', 'Deploy no Kubernetes', 'Aula sobre federação e WebFinger', 'Cache Redis', 'CSS moderno'];
    for (const [i, t] of texts.entries()) await post([bruno, carla][i % 2], t);
    await api().post('/api/users/carla/follow').set(ana.auth);
    const settings = { topics: { frontend: 0.9, bancos: 0.4 }, keywords: ['webfinger'], muted_topics: ['infra'], diversity: 0.3 };
    await api().put('/api/feed/preferencias').set(ana.auth).send(settings);
    const p = (await candidatos(ana)).body.data.find((x) => x.text === 'Cache Redis');
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth); // aprendizado no servidor

    const server = (await api().get('/api/feed/interesses?max_results=50').set(ana.auth)).body.data.map((x) => x.id);
    const { settings: saved, learned } = await prefs(ana);
    const device = rankOnDevice((await candidatos(ana)).body, saved, learned);
    expect(device).toEqual(server);
    expect(server).toHaveLength(5); // infra silenciado
  });

  it('ir para o aparelho apaga do servidor as preferências do algoritmo, o aprendizado e os escondidos', async () => {
    const p = await post(bruno, 'Postgres e cache');
    await api().put('/api/feed/preferencias').set(ana.auth).send({ topics: { bancos: 1 }, keywords: ['x1'], missions_enabled: false });
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    await api().post(`/api/posts/${(await post(carla, 'React')).id}/feedback`).set(ana.auth).send({ kind: 'less' });
    let before = await prefs(ana);
    expect(before.learned.topics.length).toBeGreaterThan(0);
    expect(before.hidden_post_ids).toHaveLength(1);

    const res = await setMode(ana, 'device');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('device');
    const after = await prefs(ana);
    expect(after.settings).toMatchObject({ ranking_mode: 'device', topics: {}, keywords: [], missions_enabled: false });
    expect(after.learned).toEqual({ topics: [], authors: [] });
    expect(after.hidden_post_ids).toEqual([]);
    for (const t of ['learned_topics', 'learned_authors', 'hidden_posts']) {
      expect((await query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [ana.user.id])).rows[0].n, t).toBe(0);
    }
  });

  it('no aparelho, curtir e "menos disto" não deixam rastro de aprendizado no servidor', async () => {
    await setMode(ana, 'device');
    const p = await post(bruno, 'Postgres e Redis');
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    await api().post(`/api/posts/${p.id}/repost`).set(ana.auth);
    await post(ana, 'Concordo muito com isso!', p.id);
    const fb = await api().post(`/api/posts/${p.id}/feedback`).set(ana.auth).send({ kind: 'less' });
    expect(fb.body).toEqual({ ok: true, kind: 'less', stored: false });
    const after = await prefs(ana);
    expect(after.learned).toEqual({ topics: [], authors: [] });
    expect(after.hidden_post_ids).toEqual([]);
    // a curtida em si continua sendo pública e contada normalmente
    expect((await api().get(`/api/posts/${p.id}`)).body.data.public_metrics.like_count).toBe(1);
  });

  it('voltar para o servidor retoma o aprendizado lá', async () => {
    await setMode(ana, 'device');
    const back = await setMode(ana, 'server');
    expect(back.body.settings.ranking_mode).toBe('server');
    const p = await post(bruno, 'Postgres');
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    expect((await prefs(ana)).learned.topics.map((t) => t.topic)).toEqual(['bancos']);
  });

  it('valida o modo e não deixa trocá-lo pelas preferências', async () => {
    expect((await setMode(ana, 'blockchain')).status).toBe(400);
    expect((await api().put('/api/feed/modo').set(ana.auth).send({ mode: 'device', extra: 1 })).status).toBe(400);
    expect((await api().put('/api/feed/preferencias').set(ana.auth).send({ ranking_mode: 'device' })).status).toBe(400);
  });

  it('decaimento do aprendizado é o mesmo nos dois lados (função compartilhada)', () => {
    expect(decayed(0.8, new Date(Date.now() - 14 * 86_400_000))).toBeCloseTo(0.4, 2);
  });
});
