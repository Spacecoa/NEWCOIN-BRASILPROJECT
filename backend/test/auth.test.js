import { beforeEach, describe, expect, it } from 'vitest';
import { api, resetDb, signup } from './helpers.js';

describe('autenticação', () => {
  beforeEach(resetDb);

  it('registra, faz login por e-mail ou username e retorna /me', async () => {
    const { user } = await signup('alice', { display_name: 'Alice' });
    expect(user).toMatchObject({ username: 'alice', display_name: 'Alice', handle: 'alice@agora.test' });
    expect(user).not.toHaveProperty('password_hash');
    expect(user).not.toHaveProperty('email');

    for (const login of ['alice@exemplo.test', 'ALICE']) {
      const res = await api().post('/api/auth/login').send({ login, password: 'senha1234' });
      expect(res.status).toBe(200);
      const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
      expect(me.body.user.id).toBe(user.id);
    }
  });

  it('recusa senha errada e usuário inexistente com a mesma mensagem', async () => {
    await signup('alice');
    const wrong = await api().post('/api/auth/login').send({ login: 'alice', password: 'errada123' });
    const missing = await api().post('/api/auth/login').send({ login: 'ninguem', password: 'errada123' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error).toBe(missing.body.error);
  });

  it('valida entrada e impede duplicatas', async () => {
    const bad = await api().post('/api/auth/register').send({ username: 'a', email: 'x', password: '1' });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d) => d.path)).toEqual(expect.arrayContaining(['username', 'email', 'password']));
    await signup('alice');
    const dup = await api().post('/api/auth/register').send({ username: 'Alice', email: 'outro@x.io', password: 'senha1234' });
    expect(dup.status).toBe(409);
  });

  it('rejeita token ausente, inválido ou adulterado', async () => {
    const { token } = await signup('alice');
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set('Authorization', 'Bearer xyz')).status).toBe(401);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
  });
});
