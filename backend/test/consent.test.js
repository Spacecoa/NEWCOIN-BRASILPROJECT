import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { CONSENT_VERSION } from '../src/lib/consent.js';
import { api, resetDb, signup } from './helpers.js';

const register = (extra) =>
  api().post('/api/auth/register').send({ username: 'nina', email: 'nina@exemplo.test', password: 'senha1234', accept_rules: true, ...extra });

describe('termo de consentimento do piloto', () => {
  beforeEach(resetDb);

  it('é público e diz quem conduz, o que guarda, para quê, por quanto tempo e como sair', async () => {
    const res = await api().get('/api/instancia/termo');
    expect(res.status).toBe(200);
    const term = res.body.data;
    expect(term.version).toBe(CONSENT_VERSION);
    expect(term.sections.map((s) => s.title)).toEqual([
      'Quem conduz a pesquisa',
      'O que o app guarda',
      'Para quê',
      'O que não fazemos',
      'Quem vê o quê',
      'Por quanto tempo',
      'Riscos e cuidados',
      'Seus direitos (LGPD, art. 18)',
    ]);
    const all = JSON.stringify(term);
    expect(all).toMatch(/IP não vai para o banco/);
    expect(all).toMatch(/Privacidade e dados/);
    expect(term.accept_label).toMatch(/18 anos ou mais/);
  });

  it('o cadastro exige aceitar o termo e guarda a versão e a data', async () => {
    const without = await register({});
    expect(without.status).toBe(400);
    expect(without.body.details.map((d) => d.path)).toContain('accept_consent');
    expect((await register({ accept_consent: false })).status).toBe(400);

    const ok = await register({ accept_consent: true, consent_version: CONSENT_VERSION });
    expect(ok.status).toBe(201);
    expect(ok.body.user.consent).toMatchObject({ version: CONSENT_VERSION, current: CONSENT_VERSION, pending: false });
    const { rows } = await query('SELECT consent_version, consent_at FROM users WHERE username = $1', ['nina']);
    expect(rows[0].consent_version).toBe(CONSENT_VERSION);
    expect(rows[0].consent_at).toBeInstanceOf(Date);
  });

  it('se o termo mudou enquanto a pessoa lia, o cadastro pede para reler', async () => {
    const res = await register({ accept_consent: true, consent_version: '2020-01-velho' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/termo de consentimento mudou/);
  });

  it('conta sem o aceite da versão atual vê pending no login e aceita depois', async () => {
    const ana = await signup('ana');
    await query("UPDATE users SET consent_version = '2020-01-velho' WHERE id = $1", [ana.user.id]);
    const login = await api().post('/api/auth/login').send({ email: 'ana@exemplo.test', password: 'senha1234' });
    expect(login.body.user.consent).toMatchObject({ version: '2020-01-velho', pending: true });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    expect((await api().get('/api/auth/me').set(auth)).body.user.consent.pending).toBe(true);

    expect((await api().post('/api/conta/termo').set(auth).send({ version: 'outra' })).status).toBe(409);
    const accepted = await api().post('/api/conta/termo').set(auth).send({ version: CONSENT_VERSION });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user.consent).toMatchObject({ version: CONSENT_VERSION, pending: false });
    expect((await api().get('/api/auth/me').set(auth)).body.user.consent.pending).toBe(false);
  });

  it('a situação do termo só aparece para a própria pessoa', async () => {
    const [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
    const profile = await api().get('/api/users/ana').set(bruno.auth);
    expect(JSON.stringify(profile.body)).not.toContain('consent');
    expect(ana.user.consent.pending).toBe(false);
  });
});
