import { beforeEach, describe, expect, it } from 'vitest';
import { api, post, resetDb, signup } from './helpers.js';

describe('perfis e follows', () => {
  let alice, bob;
  beforeEach(async () => {
    await resetDb();
    alice = await signup('alice');
    bob = await signup('bob');
  });

  it('perfil traz métricas e relação com o viewer', async () => {
    await post(bob, 'oi');
    await api().post('/api/users/bob/follow').set(alice.auth);
    await api().post('/api/users/bob/follow').set(alice.auth); // idempotente
    const asAlice = await api().get('/api/users/bob').set(alice.auth);
    expect(asAlice.body.data.public_metrics).toEqual({ followers_count: 1, following_count: 0, post_count: 1 });
    expect(asAlice.body.data.relationship).toEqual({ following: true, followed_by: false, blocking: false, blocked_by: false, muting: false });
    const anon = await api().get('/api/users/bob');
    expect(anon.body.data.relationship).toBeNull();
  });

  it('lista seguidores/seguindo e impede seguir a si mesmo', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    expect((await api().get('/api/users/bob/followers')).body.data.map((u) => u.username)).toEqual(['alice']);
    expect((await api().get('/api/users/alice/following')).body.data.map((u) => u.username)).toEqual(['bob']);
    expect((await api().post('/api/users/alice/follow').set(alice.auth)).status).toBe(409);
    expect((await api().post('/api/users/naoexiste/follow').set(alice.auth)).status).toBe(404);
  });

  it('timeline do usuário aceita exclude=replies,reposts', async () => {
    const root = await post(alice, 'raiz');
    await post(bob, 'post do bob');
    await post(bob, 'reply do bob', root.id);
    await api().post(`/api/posts/${root.id}/repost`).set(bob.auth);
    expect((await api().get('/api/users/bob/posts')).body.data).toHaveLength(3);
    const only = await api().get('/api/users/bob/posts?exclude=replies,reposts');
    expect(only.body.data.map((p) => p.text)).toEqual(['post do bob']);
  });

  it('busca usuários por nome', async () => {
    const res = await api().get('/api/users?q=ali');
    expect(res.body.data.map((u) => u.username)).toEqual(['alice']);
  });
});
