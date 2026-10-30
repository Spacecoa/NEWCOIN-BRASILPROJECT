import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { clearMail, sentMail } from '../src/lib/mailer.js';
import { api, resetDb, signup } from './helpers.js';

const forgot = (email) => api().post('/api/auth/senha/esqueci').send({ email });
const reset = (token, password) => api().post('/api/auth/senha/redefinir').send({ token, password });
const login = (email, password) => api().post('/api/auth/login').send({ email, password });
const linkToken = (mail) => mail.text.match(/redefinir-senha\?token=([A-Za-z0-9_-]{43})/)[1];

describe('recuperar senha', () => {
  let ana;
  beforeEach(async () => {
    await resetDb();
    clearMail();
    ana = await signup('ana');
  });

  it('a resposta é a mesma para e-mail cadastrado ou não, e só a conta que existe recebe o link', async () => {
    const known = await forgot(' ANA@exemplo.test ');
    const unknown = await forgot('ninguem@exemplo.test');
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.headers['cache-control']).toBe('no-store');
    const mail = sentMail();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: 'ana@exemplo.test', subject: 'Ágora: redefinir sua senha' });
    expect(mail[0].text).toContain('http://localhost:5173/redefinir-senha?token=');
    // O banco guarda só o hash: o token do link não aparece em lugar nenhum dele.
    const { rows } = await query('SELECT token_hash FROM password_resets');
    expect(rows[0].token_hash).not.toBe(linkToken(mail[0]));
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o link troca a senha, vale uma vez só, invalida os outros links e encerra as sessões', async () => {
    await forgot('ana@exemplo.test');
    await forgot('ana@exemplo.test');
    const [first, second] = sentMail().map(linkToken);
    const res = await reset(second, 'senha-nova-123');
    expect(res.status).toBe(200);
    expect((await login('ana@exemplo.test', 'senha1234')).status).toBe(401);
    expect((await login('ana@exemplo.test', 'senha-nova-123')).status).toBe(200);
    // A sessão aberta antes da troca não vale mais.
    expect((await api().get('/api/auth/me').set(ana.auth)).status).toBe(401);
    expect((await reset(second, 'outra-senha-456')).status).toBe(400);
    expect((await reset(first, 'outra-senha-456')).status).toBe(400);
  });

  it('link vencido ou inventado não funciona; senha curta é recusada', async () => {
    await forgot('ana@exemplo.test');
    const token = linkToken(sentMail()[0]);
    expect((await reset(token, 'curta')).status).toBe(400);
    expect((await reset('A'.repeat(43), 'senha-nova-123')).status).toBe(400);
    expect((await reset('../../x', 'senha-nova-123')).status).toBe(400);
    await query("UPDATE password_resets SET expires_at = now() - interval '1 minute'");
    const expired = await reset(token, 'senha-nova-123');
    expect(expired.status).toBe(400);
    expect(expired.body.error).toMatch(/venceu ou já foi usado/);
    expect((await login('ana@exemplo.test', 'senha1234')).status).toBe(200);
  });

  it('no máximo 3 e-mails por hora para a mesma conta, sem mudar a resposta', async () => {
    for (let i = 0; i < 5; i++) expect((await forgot('ana@exemplo.test')).status).toBe(200);
    expect(sentMail()).toHaveLength(3);
  });

  it('valida o e-mail', async () => {
    expect((await forgot('nao-e-email')).status).toBe(400);
    expect((await api().post('/api/auth/senha/esqueci').send({ email: 'ana@exemplo.test', extra: 1 })).status).toBe(400);
  });
});
