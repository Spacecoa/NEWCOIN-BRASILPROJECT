import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { promoteModerators } from '../src/services/moderation.js';
import { filterAudience } from '../src/services/relations.js';
import { api, post, resetDb, signup } from './helpers.js';

const ids = (res) => res.body.data.map((p) => p.id);

let alice, bob, carol;
beforeEach(async () => {
  await resetDb();
  alice = await signup('alice');
  bob = await signup('bob');
  carol = await signup('carol');
});

describe('silenciar', () => {
  it('some dos feeds e das menções de quem silenciou, mas aparece se a pessoa abrir o perfil ou o post', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    const p = await post(bob, 'oi @alice, tudo bem?');
    expect((await api().post('/api/users/bob/mute').set(alice.auth)).body.data).toEqual({ muting: true });

    expect(ids(await api().get('/api/timeline').set(alice.auth))).not.toContain(p.id);
    expect(ids(await api().get('/api/posts').set(alice.auth))).not.toContain(p.id);
    expect(ids(await api().get('/api/mentions').set(alice.auth))).not.toContain(p.id);
    // De propósito, continua acessível.
    expect(ids(await api().get('/api/users/bob/posts').set(alice.auth))).toContain(p.id);
    expect((await api().get(`/api/posts/${p.id}`).set(alice.auth)).status).toBe(200);
    expect((await api().get('/api/users/bob').set(alice.auth)).body.data.relationship.muting).toBe(true);

    // Para o Bob nada muda e ele não fica sabendo.
    const asBob = await api().get('/api/users/alice').set(bob.auth);
    expect(asBob.body.data.relationship).toMatchObject({ blocked_by: false, blocking: false, muting: false });
    expect(ids(await api().get('/api/posts').set(carol.auth))).toContain(p.id);

    await api().delete('/api/users/bob/mute').set(alice.auth);
    expect(ids(await api().get('/api/timeline').set(alice.auth))).toContain(p.id);
  });

  it('quem silenciou não recebe aviso em tempo real nem notificação', async () => {
    await api().post('/api/users/bob/mute').set(alice.auth);
    expect(await filterAudience(bob.user.id, [alice.user.id, carol.user.id])).toEqual([carol.user.id]);
  });

  it('a lista de silenciados aparece em "conta"', async () => {
    await api().post('/api/users/bob/mute').set(alice.auth);
    const res = await api().get('/api/conta/silenciados').set(alice.auth);
    expect(res.body.data.map((u) => u.username)).toEqual(['bob']);
  });
});

describe('bloquear', () => {
  it('desfaz os follows nos dois sentidos e impede seguir de novo', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    await api().post('/api/users/alice/follow').set(bob.auth);
    await api().post('/api/users/bob/block').set(alice.auth);
    expect((await api().get('/api/users/bob/followers')).body.data).toEqual([]);
    expect((await api().get('/api/users/alice/followers')).body.data).toEqual([]);
    expect((await api().post('/api/users/alice/follow').set(bob.auth)).status).toBe(403);
    expect((await api().post('/api/users/bob/follow').set(alice.auth)).status).toBe(403);
  });

  it('nenhum dos dois vê os posts do outro, em nenhum lugar', async () => {
    const a = await post(alice, 'post da alice');
    const b = await post(bob, 'post do bob @alice');
    await api().post('/api/users/bob/block').set(alice.auth);
    for (const [who, other] of [[alice, b], [bob, a]]) {
      expect(ids(await api().get('/api/posts').set(who.auth))).not.toContain(other.id);
      expect((await api().get(`/api/posts/${other.id}`).set(who.auth)).status).toBe(404);
      expect((await api().get(`/api/posts/${other.id}/thread`).set(who.auth)).body.data ?? []).toEqual([]);
    }
    expect(ids(await api().get('/api/mentions').set(alice.auth))).not.toContain(b.id);
    const perfil = await api().get('/api/users/alice/posts').set(bob.auth);
    expect(perfil.body.meta).toMatchObject({ blocked: true, result_count: 0 });
    expect((await api().get('/api/users/alice').set(bob.auth)).body.data.relationship.blocked_by).toBe(true);
    // Quem não tem nada com isso continua vendo os dois.
    expect(ids(await api().get('/api/posts').set(carol.auth))).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('impede responder, curtir, repostar e recompensar', async () => {
    const a = await post(alice, 'post da alice');
    await api().post('/api/users/bob/block').set(alice.auth);
    expect((await api().post('/api/posts').set(bob.auth).send({ text: 'resposta', reply_to_id: a.id })).status).toBe(403);
    expect((await api().post(`/api/posts/${a.id}/like`).set(bob.auth)).status).toBe(403);
    expect((await api().post(`/api/posts/${a.id}/repost`).set(bob.auth)).status).toBe(403);
    expect((await api().post(`/api/posts/${a.id}/recompensa`).set(bob.auth)).status).toBe(403);
    // Repostar o repost de outra pessoa também não passa (vale o autor do original).
    await api().post(`/api/posts/${a.id}/repost`).set(carol.auth);
    const repostId = (await api().get('/api/users/carol/posts').set(carol.auth)).body.data[0].id;
    expect((await api().post(`/api/posts/${repostId}/repost`).set(bob.auth)).status).toBe(403);
  });

  it('busca não mostra quem tem bloqueio; desbloquear devolve a visibilidade (sem refazer follows)', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    await api().post('/api/users/bob/block').set(alice.auth);
    expect((await api().get('/api/users?q=bo').set(alice.auth)).body.data).toEqual([]);
    expect((await api().get('/api/users?q=ali').set(bob.auth)).body.data).toEqual([]);
    await api().delete('/api/users/bob/block').set(alice.auth);
    expect((await api().get('/api/users?q=bo').set(alice.auth)).body.data.map((u) => u.username)).toEqual(['bob']);
    expect((await api().get('/api/users/bob').set(alice.auth)).body.data.relationship.following).toBe(false);
  });

  it('não dá para bloquear ou silenciar a si mesmo', async () => {
    expect((await api().post('/api/users/alice/block').set(alice.auth)).status).toBe(409);
    expect((await api().post('/api/users/alice/mute').set(alice.auth)).status).toBe(409);
  });
});

describe('denunciar', () => {
  it('denuncia um post (repost vale pelo original), sem duplicar e sem se autodenunciar', async () => {
    const p = await post(bob, 'golpe: mande sua senha');
    const r = await api().post('/api/denuncias').set(alice.auth).send({ post_id: p.id, reason: 'golpe', details: 'pede senha' });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('aberta');
    expect((await api().post('/api/denuncias').set(alice.auth).send({ post_id: p.id, reason: 'spam' })).status).toBe(409);
    await api().post(`/api/posts/${p.id}/repost`).set(carol.auth);
    const repostId = (await api().get('/api/users/carol/posts').set(carol.auth)).body.data[0].id;
    await api().post('/api/denuncias').set(carol.auth).send({ post_id: repostId, reason: 'spam' });
    const { rows } = await query('SELECT post_id, target_user_id, post_text FROM reports WHERE reporter_id = $1', [carol.user.id]);
    expect(rows[0]).toEqual({ post_id: p.id, target_user_id: bob.user.id, post_text: 'golpe: mande sua senha' });
    expect((await api().post('/api/denuncias').set(bob.auth).send({ post_id: p.id, reason: 'spam' })).status).toBe(409);
  });

  it('valida o pedido: um alvo só, motivo da lista, "outro" exige explicação', async () => {
    const send = (body) => api().post('/api/denuncias').set(alice.auth).send(body);
    expect((await send({ username: 'bob', reason: 'nao-existe' })).status).toBe(400);
    expect((await send({ username: 'bob', post_id: '1', reason: 'spam' })).status).toBe(400);
    expect((await send({ reason: 'spam' })).status).toBe(400);
    expect((await send({ username: 'bob', reason: 'outro' })).status).toBe(400);
    expect((await send({ username: 'bob', reason: 'outro', details: 'perfil falso' })).status).toBe(201);
    expect((await api().get('/api/denuncias/motivos')).body.data.map((m) => m.id)).toContain('assedio');
  });

  it('a fila é só da moderação, e a moderação nunca é revelada a quem foi denunciado', async () => {
    await api().post('/api/denuncias').set(alice.auth).send({ username: 'bob', reason: 'spam' });
    expect((await api().get('/api/moderacao/denuncias').set(alice.auth)).status).toBe(403);
    expect((await api().get('/api/moderacao/denuncias').set(bob.auth)).status).toBe(403);
    await promoteModerators(['carol']);
    const fila = await api().get('/api/moderacao/denuncias').set(carol.auth);
    expect(fila.body.data).toHaveLength(1);
    expect(fila.body.data[0]).toMatchObject({ target_username: 'bob', reporter_username: 'alice', open_against_target: 1 });
    // Bob não tem como ver denúncias contra ele.
    expect((await api().get('/api/denuncias').set(bob.auth)).body.data).toEqual([]);
  });
});

describe('decisões da moderação', () => {
  let ruleId;
  beforeEach(async () => {
    await promoteModerators(['carol']);
    ruleId = (await api().get('/api/instancia/regras')).body.data.rules[0].id;
  });
  const report = async (who, body) => (await api().post('/api/denuncias').set(who.auth).send(body)).body.data.id;
  const resolve = (id, action, note) =>
    api().post(`/api/moderacao/denuncias/${id}/resolver`).set(carol.auth).send({ action, note, ...(action === 'arquivar' ? {} : { rule_id: ruleId }) });

  it('arquivar: nada acontece com a conta e quem denunciou vê o resultado', async () => {
    const id = await report(alice, { username: 'bob', reason: 'spam' });
    const res = await resolve(id, 'arquivar', 'Não viola as regras');
    expect(res.body.data).toMatchObject({ status: 'arquivada', resolution: 'arquivar', resolution_note: 'Não viola as regras' });
    const mine = (await api().get('/api/denuncias').set(alice.auth)).body.data[0];
    expect(mine).toMatchObject({ status: 'arquivada', target_username: 'bob' });
    expect(mine).not.toHaveProperty('resolved_by_username');
    expect((await resolve(id, 'arquivar')).status).toBe(409); // já decidida
  });

  it('remover post: sai do ar para todos e fecha as outras denúncias do mesmo post', async () => {
    const p = await post(bob, 'conteúdo que viola as regras');
    const r1 = await report(alice, { post_id: p.id, reason: 'odio' });
    await report(carol, { post_id: p.id, reason: 'odio' }).catch(() => {});
    const other = await report(alice, { username: 'bob', reason: 'spam' });
    const rr = await resolve(r1, 'remover_post');
    expect(rr.body.data.status).toBe('acatada');
    expect((await api().get(`/api/posts/${p.id}`)).status).toBe(404);
    const { rows } = await query("SELECT count(*)::int AS n FROM reports WHERE status = 'aberta'");
    expect(rows[0].n).toBe(1); // só a denúncia da conta, que é outro assunto
    expect((await resolve(other, 'remover_post')).status).toBe(409);
  });

  it('suspender: a conta cai na hora, não entra mais e some para todos; reativar desfaz', async () => {
    const p = await post(bob, 'spam spam');
    const id = await report(alice, { post_id: p.id, reason: 'spam' });
    await report(alice, { username: 'bob', reason: 'golpe' });
    expect((await resolve(id, 'suspender', 'Conta de spam')).body.data.status).toBe('acatada');
    expect((await api().get('/api/auth/me').set(bob.auth)).status).toBe(401); // sessão encerrada
    const login = await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' });
    expect(login.status).toBe(403);
    expect(login.body.error).toMatch(/suspensa/);
    expect((await api().get('/api/users/bob')).status).toBe(404);
    expect(ids(await api().get('/api/posts'))).not.toContain(p.id);
    expect((await api().get('/api/users?q=bo')).body.data).toEqual([]);
    const { rows } = await query("SELECT count(*)::int AS n FROM reports WHERE status = 'aberta'");
    expect(rows[0].n).toBe(0); // as outras denúncias contra o Bob foram resolvidas junto

    expect((await api().post('/api/moderacao/usuarios/bob/reativar').set(alice.auth)).status).toBe(403);
    expect((await api().post('/api/moderacao/usuarios/bob/reativar').set(carol.auth)).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' })).status).toBe(200);
  });

  it('não suspende contas da moderação nem a própria', async () => {
    await promoteModerators(['alice']);
    const id = await report(bob, { username: 'alice', reason: 'spam' });
    expect((await resolve(id, 'suspender')).status).toBe(409);
  });

  it('só quem modera decide', async () => {
    const id = await report(alice, { username: 'bob', reason: 'spam' });
    const res = await api().post(`/api/moderacao/denuncias/${id}/resolver`).set(alice.auth).send({ action: 'arquivar' });
    expect(res.status).toBe(403);
  });
});
