import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeRedis } from '../src/cache.js';
import { config } from '../src/config.js';
import { api, post, resetDb, signup } from './helpers.js';

const texts = (res) => res.body.data.map((p) => p.text);

async function readAll(who, pageSize) {
  const seen = [];
  let until = null;
  for (let guard = 0; guard < 50; guard++) {
    const res = await api()
      .get(`/api/timeline?max_results=${pageSize}${until ? `&until_id=${until}` : ''}`)
      .set(who.auth);
    seen.push(...res.body.data);
    if (!res.body.meta.next_token) break;
    until = res.body.meta.next_token;
  }
  return seen;
}

// A mesma bateria roda com Redis (fan-out on write) e sem Redis (fan-out on read via SQL):
// os dois caminhos precisam produzir exatamente o mesmo resultado.
describe.each([
  ['com Redis', 'redis://localhost:6379/1', 800],
  ['com Redis e cache pequeno (força fallback ao SQL)', 'redis://localhost:6379/1', 3],
  ['sem Redis', null, 800],
])('home timeline %s', (_label, redisUrl, cacheSize) => {
  const original = { redisUrl: config.redisUrl, size: config.timelineCacheSize };
  let alice, bob, carol;

  beforeEach(async () => {
    await closeRedis();
    config.redisUrl = redisUrl;
    config.timelineCacheSize = cacheSize;
    await resetDb();
    [alice, bob, carol] = await Promise.all([signup('alice'), signup('bob'), signup('carol')]);
  });
  afterEach(async () => {
    await closeRedis();
    config.redisUrl = original.redisUrl;
    config.timelineCacheSize = original.size;
  });

  it('mostra meus posts e de quem sigo, em ordem cronológica reversa', async () => {
    await post(bob, 'bob 1');
    await post(carol, 'carol 1');
    await post(alice, 'alice 1');
    expect(texts(await api().get('/api/timeline').set(alice.auth))).toEqual(['alice 1']);

    await api().post('/api/users/bob/follow').set(alice.auth);
    expect(texts(await api().get('/api/timeline').set(alice.auth))).toEqual(['alice 1', 'bob 1']);

    // cache já materializado: novo post do bob entra via fan-out
    await post(bob, 'bob 2');
    expect(texts(await api().get('/api/timeline').set(alice.auth))).toEqual(['bob 2', 'alice 1', 'bob 1']);

    await api().delete('/api/users/bob/follow').set(alice.auth);
    expect(texts(await api().get('/api/timeline').set(alice.auth))).toEqual(['alice 1']);
  });

  it('inclui reposts de quem sigo e omite posts apagados', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    const c = await post(carol, 'da carol');
    await api().get('/api/timeline').set(alice.auth); // materializa
    await api().post(`/api/posts/${c.id}/repost`).set(bob.auth);
    const res = await api().get('/api/timeline').set(alice.auth);
    expect(res.body.data[0].referenced_posts).toEqual([{ type: 'reposted', id: c.id }]);
    expect(res.body.includes.posts[0].text).toBe('da carol');

    const b = await post(bob, 'vou apagar');
    await api().delete(`/api/posts/${b.id}`).set(bob.auth);
    expect(texts(await api().get('/api/timeline').set(alice.auth))).not.toContain('vou apagar');
  });

  it('pagina com until_id sem duplicar nem pular itens, e since_id traz só os novos', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    for (let i = 0; i < 7; i++) await post(i % 2 ? alice : bob, `t${i}`);
    const all = await readAll(alice, 2);
    expect(all.map((p) => p.text)).toEqual(['t6', 't5', 't4', 't3', 't2', 't1', 't0']);

    const newest = all[0].id;
    await post(bob, 'novo');
    const fresh = await api().get(`/api/timeline?since_id=${newest}`).set(alice.auth);
    expect(texts(fresh)).toEqual(['novo']);
  });
});
