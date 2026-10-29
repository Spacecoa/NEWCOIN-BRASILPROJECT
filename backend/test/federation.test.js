import { beforeEach, describe, expect, it } from 'vitest';
import { api, post, resetDb, signup } from './helpers.js';

describe('federação (somente leitura)', () => {
  beforeEach(async () => {
    await resetDb();
    await signup('alice');
  });

  it('WebFinger resolve acct:usuario@dominio', async () => {
    const res = await api().get('/.well-known/webfinger?resource=acct:alice@agora.test');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/jrd+json');
    expect(res.body.links[0].href).toBe('http://agora.test/federation/users/alice');
    expect((await api().get('/.well-known/webfinger?resource=acct:alice@outro.dominio')).status).toBe(404);
    expect((await api().get('/.well-known/webfinger?resource=alice')).status).toBe(400);
  });

  it('outbox publica posts como atividades Create/Note', async () => {
    const alice = { auth: { Authorization: `Bearer ${(await api().post('/api/auth/login').send({ login: 'alice', password: 'senha1234' })).body.token}` } };
    const p = await post(alice, 'federado!');
    const res = await api().get('/federation/users/alice/outbox');
    expect(res.body.type).toBe('OrderedCollection');
    expect(res.body.orderedItems[0]).toMatchObject({
      type: 'Create',
      object: { type: 'Note', content: '<p>federado!</p>', id: `http://agora.test/posts/${p.id}` },
    });
  });
});
