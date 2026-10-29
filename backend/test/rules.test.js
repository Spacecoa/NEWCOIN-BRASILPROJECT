import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { promoteModerators } from '../src/services/moderation.js';
import { DEFAULT_RULES } from '../src/services/rules.js';
import { api, post, resetDb, signup, asReader } from './helpers.js';

let alice, bob, mod, rules;
beforeEach(async () => {
  await resetDb();
  alice = await signup('alice');
  bob = await signup('bob');
  mod = await signup('mod');
  await promoteModerators(['mod']);
  rules = (await api().get('/api/instancia/regras')).body.data.rules;
});

const report = async (who, body) => (await api().post('/api/denuncias').set(who.auth).send(body)).body.data.id;
const resolve = (id, action, ruleId, note) =>
  api().post(`/api/moderacao/denuncias/${id}/resolver`).set(mod.auth).send({ action, note, ...(ruleId ? { rule_id: ruleId } : {}) });

describe('regras da instância', () => {
  it('são públicas, numeradas e mostram quem modera', async () => {
    const res = await api().get('/api/instancia/regras');
    expect(res.status).toBe(200);
    expect(res.body.data.rules.map((r) => r.title)).toEqual(DEFAULT_RULES.map(([t]) => t));
    expect(res.body.data.rules.map((r) => r.position)).toEqual(DEFAULT_RULES.map((_, i) => i + 1));
    expect(res.body.data.moderators.map((m) => m.username)).toEqual(['mod']);
    expect(res.body.data.updated_at).toBeTruthy();
  });

  it('cadastro exige aceitar as regras e registra quando', async () => {
    const without = await api().post('/api/auth/register').send({ username: 'nina', email: 'n@x.io', password: 'senha1234' });
    expect(without.status).toBe(400);
    expect(without.body.details.map((d) => d.path)).toContain('accept_rules');
    expect((await api().post('/api/auth/register').send({ username: 'nina', email: 'n@x.io', password: 'senha1234', accept_rules: false })).status).toBe(400);
    const ok = await api().post('/api/auth/register').send({ username: 'nina', email: 'n@x.io', password: 'senha1234', accept_rules: true });
    expect(ok.status).toBe(201);
    const { rows } = await query('SELECT rules_accepted_at FROM users WHERE username = $1', ['nina']);
    expect(rows[0].rules_accepted_at).toBeInstanceOf(Date);
  });

  it('só a moderação edita; editar reordena, cria e arquiva (sem apagar)', async () => {
    const [r1, r2, ...rest] = rules;
    const body = { rules: [{ id: r2.id, title: r2.title, description: 'Texto novo' }, { id: r1.id, title: r1.title, description: r1.description }, { title: 'Regra nova', description: '' }] };
    expect((await api().put('/api/moderacao/regras').set(alice.auth).send(body)).status).toBe(403);
    const res = await api().put('/api/moderacao/regras').set(mod.auth).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.rules.map((r) => [r.position, r.title])).toEqual([[1, r2.title], [2, r1.title], [3, 'Regra nova']]);
    expect(res.body.data.rules[0].description).toBe('Texto novo');
    const { rows } = await query('SELECT count(*)::int AS n FROM instance_rules WHERE archived_at IS NOT NULL');
    expect(rows[0].n).toBe(rest.length);
    expect((await api().put('/api/moderacao/regras').set(mod.auth).send({ rules: [] })).status).toBe(400);
  });
});

describe('decisões citam uma regra', () => {
  it('remover ou suspender sem regra (ou com regra arquivada) é recusado; arquivar não precisa', async () => {
    const p = await post(bob, 'spam');
    const id = await report(alice, { post_id: p.id, reason: 'spam' });
    expect((await resolve(id, 'remover_post')).status).toBe(400);
    await api().put('/api/moderacao/regras').set(mod.auth).send({ rules: [{ id: rules[1].id, title: rules[1].title }] });
    expect((await resolve(id, 'remover_post', rules[0].id)).status).toBe(400); // arquivada
    const ok = await resolve(id, 'remover_post', rules[1].id, 'Spam repetido');
    expect(ok.status).toBe(200);
    expect(ok.body.data.rule).toMatchObject({ id: rules[1].id, position: 1, title: rules[1].title });
    // Quem denunciou vê a regra citada.
    const mine = (await api().get('/api/denuncias').set(alice.auth)).body.data[0];
    expect(mine.rule.title).toBe(rules[1].title);
    const other = await report(alice, { username: 'bob', reason: 'spam' });
    expect((await resolve(other, 'arquivar')).status).toBe(200);
  });
});

describe('quem foi afetado vê a decisão e pode recorrer', () => {
  it('post removido: aparece em "decisões", o recurso é um só, e aceitar devolve o post', async () => {
    const p = await post(bob, 'post contestável');
    const rid = await report(alice, { post_id: p.id, reason: 'assedio' });
    await resolve(rid, 'remover_post', rules[0].id, 'Ataque pessoal');
    expect((await api().get(`/api/posts/${p.id}`).set(await asReader())).status).toBe(404);

    const decisions = (await api().get('/api/conta/decisoes').set(bob.auth)).body.data;
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'post_removido', post_text: 'post contestável', note: 'Ataque pessoal', appeal_status: null });
    expect(decisions[0].rule.title).toBe(rules[0].title);
    expect((await api().get('/api/conta/decisoes').set(alice.auth)).body.data).toEqual([]);

    const sid = decisions[0].id;
    expect((await api().post(`/api/conta/decisoes/${sid}/recurso`).set(alice.auth).send({ text: 'não é meu, mas quero recorrer' })).status).toBe(404);
    expect((await api().post(`/api/conta/decisoes/${sid}/recurso`).set(bob.auth).send({ text: 'curto' })).status).toBe(400);
    const ap = await api().post(`/api/conta/decisoes/${sid}/recurso`).set(bob.auth).send({ text: 'Foi uma crítica à ideia, não à pessoa.' });
    expect(ap.status).toBe(201);
    expect((await api().post(`/api/conta/decisoes/${sid}/recurso`).set(bob.auth).send({ text: 'de novo, por favor' })).status).toBe(409);

    expect((await api().get('/api/moderacao/recursos').set(alice.auth)).status).toBe(403);
    const fila = (await api().get('/api/moderacao/recursos').set(mod.auth)).body.data;
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ username: 'bob', appeal_text: 'Foi uma crítica à ideia, não à pessoa.', decided_by_username: 'mod' });

    const dec = await api().post(`/api/moderacao/recursos/${sid}/decidir`).set(mod.auth).send({ decision: 'aceitar', note: 'Revisado: crítica legítima' });
    expect(dec.body.data).toEqual({ id: sid, appeal_status: 'aceito', reverted: true });
    expect((await api().get(`/api/posts/${p.id}`).set(await asReader())).status).toBe(200);
    const after = (await api().get('/api/conta/decisoes').set(bob.auth)).body.data[0];
    expect(after).toMatchObject({ appeal_status: 'aceito', appeal_note: 'Revisado: crítica legítima' });
    expect(after.reverted_at).toBeTruthy();
    expect((await api().get('/api/moderacao/recursos').set(mod.auth)).body.data).toEqual([]);
  });

  it('removido some de tudo: não dá para responder, curtir, repostar nem recompensar', async () => {
    const p = await post(bob, 'vai sair do ar');
    const rid = await report(alice, { post_id: p.id, reason: 'spam' });
    await resolve(rid, 'remover_post', rules[3].id);
    expect((await api().post('/api/posts').set(alice.auth).send({ text: 'resposta', reply_to_id: p.id })).status).toBe(404);
    expect((await api().post(`/api/posts/${p.id}/like`).set(alice.auth)).status).toBe(404);
    expect((await api().post(`/api/posts/${p.id}/repost`).set(alice.auth)).status).toBe(404);
    expect((await api().post(`/api/posts/${p.id}/recompensa`).set(alice.auth)).status).toBe(404);
    expect((await api().get('/api/posts').set(alice.auth)).body.data.map((x) => x.id)).not.toContain(p.id);
    expect((await api().get('/api/users/bob').set(alice.auth)).body.data.public_metrics.post_count).toBe(0);
  });

  it('conta suspensa: o login mostra a regra e a nota; o recurso confere e-mail e senha', async () => {
    const rid = await report(alice, { username: 'bob', reason: 'golpe' });
    await resolve(rid, 'suspender', rules[2].id, 'Pedia senhas');
    const login = await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' });
    expect(login.status).toBe(403);
    expect(login.body.suspension).toMatchObject({ note: 'Pedia senhas', can_appeal: true, appeal_status: null });
    expect(login.body.suspension.rule.title).toBe(rules[2].title);
    // Senha errada não revela nada sobre a suspensão.
    const wrong = await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'errada123' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.suspension).toBeUndefined();

    const send = (body) => api().post('/api/recursos/suspensao').send(body);
    expect((await send({ email: 'bob@exemplo.test', password: 'errada123', text: 'quero recorrer da suspensão' })).status).toBe(401);
    // Conta não suspensa com a senha certa recebe a mesma resposta da senha errada (docs/14, M-2).
    expect((await send({ email: 'alice@exemplo.test', password: 'senha1234', text: 'quero recorrer da suspensão' })).status).toBe(401);
    expect((await send({ email: 'bob@exemplo.test', password: 'senha1234', text: 'Minha conta foi invadida naquele dia.' })).status).toBe(201);
    expect((await send({ email: 'bob@exemplo.test', password: 'senha1234', text: 'mais uma vez por favor' })).status).toBe(409);
    const again = await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' });
    expect(again.body.suspension).toMatchObject({ appeal_status: 'aberto', can_appeal: false });

    const [ap] = (await api().get('/api/moderacao/recursos').set(mod.auth)).body.data;
    await api().post(`/api/moderacao/recursos/${ap.id}/decidir`).set(mod.auth).send({ decision: 'aceitar' });
    expect((await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' })).status).toBe(200);
  });

  it('recurso negado mantém a decisão e fica registrado', async () => {
    const rid = await report(alice, { username: 'bob', reason: 'spam' });
    await resolve(rid, 'suspender', rules[3].id);
    await api().post('/api/recursos/suspensao').send({ email: 'bob@exemplo.test', password: 'senha1234', text: 'Não era spam, era divulgação.' });
    const [ap] = (await api().get('/api/moderacao/recursos').set(mod.auth)).body.data;
    const dec = await api().post(`/api/moderacao/recursos/${ap.id}/decidir`).set(mod.auth).send({ decision: 'negar', note: 'Mesma mensagem 40 vezes' });
    expect(dec.body.data).toMatchObject({ appeal_status: 'negado', reverted: false });
    const login = await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' });
    expect(login.status).toBe(403);
    expect(login.body.suspension).toMatchObject({ appeal_status: 'negado', appeal_note: 'Mesma mensagem 40 vezes', can_appeal: false });
    const decididos = (await api().get('/api/moderacao/recursos?status=decidido').set(mod.auth)).body.data;
    expect(decididos[0]).toMatchObject({ appeal_status: 'negado', appeal_resolved_by_username: 'mod' });
    expect((await api().post(`/api/moderacao/recursos/${ap.id}/decidir`).set(mod.auth).send({ decision: 'aceitar' })).status).toBe(404);
  });

  it('reativar pela moderação também desfaz a decisão registrada', async () => {
    const rid = await report(alice, { username: 'bob', reason: 'spam' });
    await resolve(rid, 'suspender', rules[3].id);
    await api().post('/api/moderacao/usuarios/bob/reativar').set(mod.auth);
    const login = await api().post('/api/auth/login').send({ email: 'bob@exemplo.test', password: 'senha1234' });
    const d = (await api().get('/api/conta/decisoes').set({ Authorization: `Bearer ${login.body.token}` })).body.data[0];
    expect(d.reverted_at).toBeTruthy();
    expect((await api().post(`/api/conta/decisoes/${d.id}/recurso`).set({ Authorization: `Bearer ${login.body.token}` }).send({ text: 'já foi desfeita, mas tento' })).status).toBe(409);
  });
});
