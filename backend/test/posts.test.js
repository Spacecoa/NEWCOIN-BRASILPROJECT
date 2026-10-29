import { beforeEach, describe, expect, it } from 'vitest';
import { api, post, resetDb, signup, asReader } from './helpers.js';

describe('posts, threads e interações', () => {
  let alice, bob;
  beforeEach(async () => {
    await resetDb();
    alice = await signup('alice');
    bob = await signup('bob');
  });

  it('cria post com dados do autor em includes', async () => {
    const res = await api().post('/api/posts').set(alice.auth).send({ text: 'olá mundo' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      text: 'olá mundo',
      author_id: alice.user.id,
      in_reply_to_post_id: null,
      referenced_posts: [],
      public_metrics: { like_count: 0, reply_count: 0, repost_count: 0 },
    });
    expect(res.body.data.conversation_id).toBe(res.body.data.id);
    expect(res.body.includes.users[0].username).toBe('alice');
  });

  it('valida texto vazio, >280 caracteres e exige autenticação', async () => {
    expect((await api().post('/api/posts').send({ text: 'x' })).status).toBe(401);
    expect((await api().post('/api/posts').set(alice.auth).send({ text: '   ' })).status).toBe(400);
    expect((await api().post('/api/posts').set(alice.auth).send({ text: 'a'.repeat(281) })).status).toBe(400);
    expect((await api().post('/api/posts').set(alice.auth).send({ text: 'a'.repeat(280) })).status).toBe(201);
  });

  it('monta threads: conversation_id herdado, reply_count e árvore completa', async () => {
    const root = await post(alice, 'raiz');
    const r1 = await post(bob, 'resposta 1', root.id);
    const r2 = await post(alice, 'resposta à resposta', r1.id);
    await post(alice, 'outro post solto');

    expect(r1.conversation_id).toBe(root.id);
    expect(r2.conversation_id).toBe(root.id);
    expect(r2.referenced_posts).toEqual([{ type: 'replied_to', id: r1.id }]);

    const thread = await api().get(`/api/posts/${r1.id}/thread`).set(await asReader());
    expect(thread.body.data.map((p) => p.id)).toEqual([root.id, r1.id, r2.id]);
    expect(thread.body.meta).toMatchObject({ conversation_id: root.id, focal_id: r1.id });
    expect(thread.body.data[0].public_metrics.reply_count).toBe(1);

    const missing = await api().post('/api/posts').set(bob.auth).send({ text: 'x', reply_to_id: '123' });
    expect(missing.status).toBe(404);
  });

  it('likes são idempotentes e refletem no estado do viewer', async () => {
    const p = await post(alice, 'curta isso');
    await api().post(`/api/posts/${p.id}/like`).set(bob.auth);
    const again = await api().post(`/api/posts/${p.id}/like`).set(bob.auth);
    expect(again.body.data.public_metrics.like_count).toBe(1);
    expect(again.body.data.viewer.liked).toBe(true);
    const asAlice = await api().get(`/api/posts/${p.id}`).set(alice.auth);
    expect(asAlice.body.data.viewer.liked).toBe(false);
    const un = await api().delete(`/api/posts/${p.id}/like`).set(bob.auth);
    expect(un.body.data.public_metrics.like_count).toBe(0);
    await api().delete(`/api/posts/${p.id}/like`).set(bob.auth);
    expect((await api().get(`/api/posts/${p.id}`).set(await asReader())).body.data.public_metrics.like_count).toBe(0);
  });

  it('repost cria um post que referencia o original; repost de repost aponta ao original', async () => {
    const carol = await signup('carol');
    const p = await post(alice, 'original');
    const res = await api().post(`/api/posts/${p.id}/repost`).set(bob.auth);
    expect(res.body.data.public_metrics.repost_count).toBe(1);
    expect(res.body.data.viewer.reposted).toBe(true);

    const bobPosts = await api().get('/api/users/bob/posts').set(await asReader());
    const repostItem = bobPosts.body.data[0];
    expect(repostItem.referenced_posts).toEqual([{ type: 'reposted', id: p.id }]);
    expect(bobPosts.body.includes.posts.map((x) => x.id)).toContain(p.id);

    // carol reposta o repost do bob => conta no original
    const viaRepost = await api().post(`/api/posts/${repostItem.id}/repost`).set(carol.auth);
    expect(viaRepost.body.data.id).toBe(p.id);
    expect(viaRepost.body.data.public_metrics.repost_count).toBe(2);
    // repostar de novo não duplica
    await api().post(`/api/posts/${p.id}/repost`).set(bob.auth);
    expect((await api().get(`/api/posts/${p.id}`).set(await asReader())).body.data.public_metrics.repost_count).toBe(2);

    const undo = await api().delete(`/api/posts/${p.id}/repost`).set(bob.auth);
    expect(undo.body.data.public_metrics.repost_count).toBe(1);
  });

  it('só o autor apaga; apagar reply decrementa o contador do pai', async () => {
    const root = await post(alice, 'raiz');
    const reply = await post(bob, 'reply', root.id);
    expect((await api().delete(`/api/posts/${reply.id}`).set(alice.auth)).status).toBe(403);
    expect((await api().delete(`/api/posts/${reply.id}`).set(bob.auth)).status).toBe(200);
    const after = await api().get(`/api/posts/${root.id}`).set(await asReader());
    expect(after.body.data.public_metrics.reply_count).toBe(0);
    expect((await api().get(`/api/posts/${reply.id}`).set(await asReader())).status).toBe(404);
  });

  it('menções viram entradas em /api/mentions (sem auto-menção)', async () => {
    await post(bob, 'oi @alice e @bob e @fantasma');
    const res = await api().get('/api/mentions').set(alice.auth);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].text).toContain('@alice');
    const own = await api().get('/api/mentions').set(bob.auth);
    expect(own.body.data).toHaveLength(0);
  });

  it('timeline pública lista posts (sem reposts) e pagina por cursor', async () => {
    for (let i = 0; i < 5; i++) await post(alice, `p${i}`);
    await api().post(`/api/posts/${(await post(bob, 'b')).id}/repost`).set(alice.auth);
    const first = await api().get('/api/posts?max_results=4').set(await asReader());
    expect(first.body.data.map((p) => p.text)).toEqual(['b', 'p4', 'p3', 'p2']);
    const second = await api().get(`/api/posts?max_results=4&until_id=${first.body.meta.next_token}`).set(await asReader());
    expect(second.body.data.map((p) => p.text)).toEqual(['p1', 'p0']);
    expect(second.body.meta.next_token).toBeUndefined();
  });
});
