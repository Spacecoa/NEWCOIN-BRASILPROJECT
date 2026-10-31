import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { query } from '../src/db.js';
import { encodePng } from '../src/lib/png.js';
import { promoteModerators } from '../src/services/moderation.js';
import { api, post, resetDb, signup } from './helpers.js';

const png = () => encodePng(20, 10, (x, y) => [x * 9, y * 20, 120]);
const exportData = (who) => api().get('/api/conta/dados').set(who.auth);
const remove = (who, password = 'senha1234') => api().delete('/api/conta').set(who.auth).send({ password });
const age = (who) => query("UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1", [who.user.id]);
const metrics = async (who, id) => (await api().get(`/api/posts/${id}`).set(who.auth)).body.data.public_metrics;

describe('baixar meus dados', () => {
  let ana, bruno;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
  });

  it('exige login e vem como arquivo, sem cache', async () => {
    expect((await api().get('/api/conta/dados')).status).toBe(401);
    const res = await exportData(ana);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="agora-dados-ana-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ formato: 'agora-dados/1', conta: { username: 'ana', email: 'ana@exemplo.test' } });
  });

  it('traz posts com edições, imagens, curtidas, seguidas, mensagens e carteira; nada de segredos', async () => {
    const m = (await api().post('/api/midia').set(ana.auth).set('Content-Type', 'image/png').send(png())).body.data;
    const p = (await api().post('/api/posts').set(ana.auth).send({ text: 'primeiro post', media: [{ id: m.id, alt: 'Faixa colorida' }] })).body.data;
    await api().patch(`/api/posts/${p.id}`).set(ana.auth).send({ text: 'primeiro post (corrigido)' });
    const b = await post(bruno, 'post do bruno');
    await api().post(`/api/posts/${b.id}/like`).set(ana.auth);
    await api().post('/api/users/bruno/follow').set(ana.auth);
    await api().post('/api/users/ana/follow').set(bruno.auth);
    await api().post('/api/channels').set(ana.auth).send({ slug: 'bairro', title: 'Bairro', kind: 'group' });
    await api().post('/api/channels/bairro/messages').set(ana.auth).send({ text: 'oi, vizinhança' });

    const { body } = await exportData(ana);
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0]).toMatchObject({ text: 'primeiro post (corrigido)', edicoes: [{ text: 'primeiro post' }] });
    expect(body.imagens).toHaveLength(1);
    expect(body.imagens[0]).toMatchObject({ mime: 'image/png', alt: 'Faixa colorida' });
    expect(Buffer.from(body.imagens[0].base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(body.curtidas.map((l) => l.post_id)).toEqual([b.id]);
    expect(body.seguindo.map((f) => f.username)).toEqual(['bruno']);
    expect(body.seguidores.map((f) => f.username)).toEqual(['bruno']);
    expect(body.canais).toMatchObject([{ slug: 'bairro', role: 'owner' }]);
    expect(body.mensagens).toMatchObject([{ canal: 'bairro', text: 'oi, vizinhança' }]);
    expect(body.newcoin.saldo).toBe(body.newcoin.extrato.reduce((s, l) => s + l.amount, 0));
    expect(body.sessoes.length).toBeGreaterThan(0);

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password_hash|refresh_hash|token_hash|\$2[aby]\$/);
    // Só os dados de quem pediu: nada do post do bruno além do id curtido.
    expect(raw).not.toContain('post do bruno');
  });

  it('não mostra quem denunciou a pessoa nem quem moderou', async () => {
    const p = await post(ana, 'post denunciado');
    await api().post('/api/denuncias').set(bruno.auth).send({ post_id: p.id, reason: 'spam' });
    const { body } = await exportData(ana);
    expect(JSON.stringify(body)).not.toContain('bruno');
    expect(body.denuncias_feitas).toEqual([]);
  });
});

describe('excluir a conta', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('pede a senha certa (403, sem derrubar a sessão) e exige login', async () => {
    expect((await api().delete('/api/conta').send({ password: 'senha1234' })).status).toBe(401);
    expect((await remove(ana, 'errada')).status).toBe(403);
    expect((await remove(ana, '')).status).toBe(400);
    expect((await api().get('/api/auth/me').set(ana.auth)).status).toBe(200);
  });

  it('apaga tudo da pessoa, encerra as sessões e libera o e-mail, mas não o @', async () => {
    const p = await post(ana, 'vou sair daqui');
    await post(bruno, `@ana até mais`);
    const res = await remove(ana);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, username: 'ana' });
    expect(res.headers['set-cookie']?.join(';')).toMatch(/agora_refresh=;/);

    expect((await api().get('/api/auth/me').set(ana.auth)).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: 'ana@exemplo.test', password: 'senha1234' })).status).toBe(401);
    expect((await api().get(`/api/posts/${p.id}`).set(bruno.auth)).status).toBe(404);
    expect((await api().get('/api/users/ana').set(bruno.auth)).status).toBe(404);
    for (const t of ['posts', 'sessions', 'mentions', 'notifications', 'token_ledger']) {
      const col = t === 'posts' ? 'author_id' : 'user_id';
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [ana.user.id]);
      expect(rows[0].n, t).toBe(0);
    }
    // O e-mail volta a ficar livre; o @ não (ninguém herda as menções antigas).
    expect((await api().post('/api/auth/register').send({ username: 'ana_nova', email: 'ana@exemplo.test', password: 'senha1234', accept_rules: true })).status).toBe(201);
    const taken = await api().post('/api/auth/register').send({ username: 'ANA', email: 'outra@exemplo.test', password: 'senha1234', accept_rules: true });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatch(/conta excluída/);
    const { rows } = await query('SELECT username_hash FROM deleted_usernames');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/ana/i);
  });

  it('os números dos posts de outras pessoas ficam certos', async () => {
    await Promise.all([age(ana), age(bruno)]);
    const b = await post(bruno, 'post do bruno');
    await api().post(`/api/posts/${b.id}/like`).set(ana.auth);
    await api().post(`/api/posts/${b.id}/like`).set(carla.auth);
    await api().post(`/api/posts/${b.id}/repost`).set(ana.auth);
    await post(ana, 'resposta da ana', b.id);
    await api().post('/api/posts').set(ana.auth).send({ text: 'citação da ana', quote_of_id: b.id });
    await api().post(`/api/posts/${b.id}/recompensa`).set(ana.auth);
    expect(await metrics(bruno, b.id)).toMatchObject({ like_count: 2, repost_count: 1, reply_count: 1, quote_count: 1, tip_count: 1 });

    expect((await remove(ana)).status).toBe(200);
    expect(await metrics(bruno, b.id)).toMatchObject({ like_count: 1, repost_count: 0, reply_count: 0, quote_count: 0, tip_count: 0 });
    // A recompensa que o bruno recebeu continua dele: o saldo bate com o extrato.
    const w = (await api().get('/api/carteira').set(bruno.auth)).body;
    expect(w.balance).toBe(w.ledger.reduce((s, l) => s + l.amount, 0));
    expect(w.ledger.some((l) => l.kind === 'tip_received')).toBe(true);
  });

  it('canal com mais gente passa para o admin (ou membro) mais antigo; canal vazio some', async () => {
    await api().post('/api/channels').set(ana.auth).send({ slug: 'bairro', title: 'Bairro', kind: 'group' });
    await api().post('/api/channels').set(ana.auth).send({ slug: 'so_meu', title: 'Só meu', kind: 'channel' });
    await api().post('/api/channels/bairro/members').set(bruno.auth);
    await api().post('/api/channels/bairro/members').set(carla.auth);
    await api().put('/api/channels/bairro/members/carla/role').set(ana.auth).send({ role: 'admin' });
    await api().post('/api/channels/bairro/messages').set(bruno.auth).send({ text: 'mensagem do bruno' });
    await api().post('/api/channels/bairro/messages').set(ana.auth).send({ text: 'mensagem da ana' });

    const res = await remove(ana);
    expect(res.body).toMatchObject({ channels_passed: 1, channels_removed: 1 });
    const ch = (await api().get('/api/channels/bairro').set(carla.auth)).body.data;
    expect(ch).toMatchObject({ viewer_role: 'owner', member_count: 2 });
    expect((await api().get('/api/channels/so_meu').set(carla.auth)).status).toBe(404);
    const msgs = (await api().get('/api/channels/bairro/messages').set(bruno.auth)).body.data;
    expect(msgs.map((m) => m.text)).toEqual(['mensagem do bruno']);
  });

  it('o convite usado não volta a valer depois que a conta é excluída', async () => {
    const { code } = (await api().post('/api/convites').set(ana.auth)).body.data;
    const nina = await signup('nina', { invite_code: code });
    expect((await remove(nina)).status).toBe(200);
    const again = await api().post('/api/auth/register').send({ username: 'otavio', email: 'o@exemplo.test', password: 'senha1234', accept_rules: true, invite_code: code });
    expect(again.status).toBe(400);
  });

  it('a única pessoa moderando não sai sem passar a moderação; o nome não vira moderador de novo', async () => {
    const old = config.moderators;
    config.moderators = ['ana'];
    try {
      await promoteModerators(['ana']);
      const res = await remove(ana);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/única pessoa que modera/);
      await promoteModerators(['bruno']);
      expect((await remove(ana)).status).toBe(200);
      const { rows } = await query('SELECT username FROM moderator_names_missing');
      expect(rows.map((r) => r.username)).toContain('ana');
    } finally {
      config.moderators = old;
    }
  });
});
