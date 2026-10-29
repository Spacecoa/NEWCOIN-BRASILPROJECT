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

  it('outbox não entrega posts: eles só são lidos por quem entrou na instância', async () => {
    const alice = { auth: { Authorization: `Bearer ${(await api().post('/api/auth/login').send({ login: 'alice', password: 'senha1234' })).body.token}` } };
    await post(alice, 'só para quem tem conta');
    const res = await api().get('/federation/users/alice/outbox');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'OrderedCollection', totalItems: 0, orderedItems: [] });
    expect(res.body.summary).toMatch(/quem tem conta/);
    expect(JSON.stringify(res.body)).not.toContain('só para quem tem conta');
  });
});
