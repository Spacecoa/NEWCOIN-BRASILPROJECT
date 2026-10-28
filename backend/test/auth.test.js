import { beforeEach, describe, expect, it } from 'vitest';
import { checkPassword, dummyHash } from '../src/lib/auth.js';
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

  it('entra com e-mail e senha (sem diferenciar maiúsculas no e-mail)', async () => {
    const { user } = await signup('alice');
    const res = await api().post('/api/auth/login').send({ email: '  ALICE@Exemplo.test ', password: 'senha1234' });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.body.user.username).toBe('alice');
  });

  it('e-mail errado, senha errada ou conta inexistente: a mesma resposta', async () => {
    await signup('alice');
    const wrongPass = await api().post('/api/auth/login').send({ email: 'alice@exemplo.test', password: 'errada123' });
    const noAccount = await api().post('/api/auth/login').send({ email: 'ninguem@exemplo.test', password: 'errada123' });
    for (const r of [wrongPass, noAccount]) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('E-mail ou senha incorretos');
    }
  });

  it('e-mail malformado ou ausente é recusado antes de consultar o banco', async () => {
    const bad = await api().post('/api/auth/login').send({ email: 'nao-e-email', password: 'x' });
    expect(bad.status).toBe(400);
    const missing = await api().post('/api/auth/login').send({ password: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body.details[0]).toMatchObject({ path: 'email', message: 'informe o e-mail' });
  });

  it('conta inexistente também paga o custo do bcrypt (não dá para medir quem existe)', async () => {
    const h = await dummyHash();
    expect(h).toMatch(/^\$2[aby]\$04\$/); // mesmo custo dos hashes reais nos testes
    expect(await checkPassword('qualquer', h)).toBe(false);
  });
});
