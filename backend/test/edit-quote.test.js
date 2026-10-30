import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { api, post, resetDb, signup } from './helpers.js';

const edit = (who, id, text) => api().patch(`/api/posts/${id}`).set(who.auth).send({ text });
const quote = (who, id, text = 'citando') => api().post('/api/posts').set(who.auth).send({ text, quote_of_id: id });
const kinds = async (who) => (await api().get('/api/notificacoes').set(who.auth)).body.data.map((n) => n.kind);

describe('editar post', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('a autora edita; o post mostra que foi editado e o histórico guarda a versão anterior', async () => {
    const p = await post(ana, 'Reunião na quinta às 18h');
    expect(p.viewer.can_edit).toBe(true);
    const res = await edit(ana, p.id, 'Reunião na quinta às 19h');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ text: 'Reunião na quinta às 19h', edit_count: 1, edited_at: expect.any(String) });
    const hist = (await api().get(`/api/posts/${p.id}/edicoes`)).body.data;
    expect(hist.current).toMatchObject({ version: 2, text: 'Reunião na quinta às 19h' });
    expect(hist.previous).toEqual([expect.objectContaining({ version: 1, text: 'Reunião na quinta às 18h' })]);
    // Quem lê vê o selo "editado", mas não pode editar.
    const seen = (await api().get(`/api/posts/${p.id}`).set(bruno.auth)).body.data;
    expect(seen).toMatchObject({ edit_count: 1 });
    expect(seen.viewer.can_edit).toBe(false);
  });

  it('só quem escreveu, só nos primeiros 30 minutos, até 5 vezes, e nunca repost', async () => {
    const p = await post(ana, 'versão 0');
    expect((await edit(bruno, p.id, 'invadido')).status).toBe(403);
    expect((await api().patch(`/api/posts/${p.id}`).send({ text: 'sem login' })).status).toBe(401);
    for (let i = 1; i <= 5; i++) expect((await edit(ana, p.id, `versão ${i}`)).status).toBe(200);
    const sixth = await edit(ana, p.id, 'versão 6');
    expect(sixth.status).toBe(409);
    expect(sixth.body.error).toMatch(/5 vezes/);
    const old = await post(ana, 'post antigo');
    await query("UPDATE posts SET created_at = now() - interval '31 minutes' WHERE id = $1", [old.id]);
    expect((await edit(ana, old.id, 'tarde demais')).body.error).toMatch(/30 minutos/);
    await api().post(`/api/posts/${p.id}/repost`).set(ana.auth);
    const { rows } = await query('SELECT id FROM posts WHERE repost_of_id = $1', [p.id]);
    expect((await edit(ana, rows[0].id, 'texto no repost')).status).toBe(409);
    expect((await edit(ana, p.id, 'x'.repeat(281))).status).toBe(400);
  });

  it('post com denúncia em análise não pode ser editado (a prova não muda)', async () => {
    const p = await post(ana, 'algo que alguém denunciou');
    await api().post('/api/denuncias').set(bruno.auth).send({ post_id: p.id, reason: 'spam' });
    const r = await edit(ana, p.id, 'agora parece inofensivo');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/denúncia em análise/);
    expect((await api().get(`/api/posts/${p.id}`).set(ana.auth)).body.data.viewer.can_edit).toBe(false);
  });

  it('menções são recalculadas e só quem passou a ser citado recebe aviso; a busca acha o texto novo', async () => {
    const p = await post(ana, 'falando com @bruno');
    expect(await kinds(bruno)).toEqual(['mention']);
    await edit(ana, p.id, 'falando com @bruno e @carla sobre horta');
    expect(await kinds(bruno)).toEqual(['mention']);
    expect(await kinds(carla)).toEqual(['mention']);
    await edit(ana, p.id, 'falando só com @carla sobre horta');
    expect((await api().get('/api/mentions').set(bruno.auth)).body.data).toEqual([]);
    expect((await api().get('/api/posts/busca?q=horta')).body.data.map((x) => x.id)).toEqual([p.id]);
  });
});

describe('citar post', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('cita: o post novo traz o original em includes, o contador sobe e a autora recebe aviso', async () => {
    const orig = await post(ana, 'Mapa do bairro pronto');
    const r = await quote(bruno, orig.id, 'Vale a pena ver isso');
    expect(r.status).toBe(201);
    expect(r.body.data.referenced_posts).toEqual([{ type: 'quoted', id: orig.id }]);
    expect(r.body.includes.posts.map((x) => x.id)).toContain(orig.id);
    expect((await api().get(`/api/posts/${orig.id}`).set(ana.auth)).body.data.public_metrics.quote_count).toBe(1);
    expect(await kinds(ana)).toEqual(['quote']);
    const out = (await api().get('/federation/users/bruno/outbox')).body;
    expect(out.orderedItems[0].object.quoteUrl).toMatch(new RegExp(`/posts/${orig.id}$`));
    // Apagar a citação devolve o contador.
    await api().delete(`/api/posts/${r.body.data.id}`).set(bruno.auth);
    expect((await api().get(`/api/posts/${orig.id}`).set(ana.auth)).body.data.public_metrics.quote_count).toBe(0);
  });

  it('não cita repost, post removido, quem bloqueou, nem responde e cita ao mesmo tempo', async () => {
    const orig = await post(ana, 'original');
    await api().post(`/api/posts/${orig.id}/repost`).set(carla.auth);
    const { rows } = await query('SELECT id FROM posts WHERE repost_of_id = $1', [orig.id]);
    expect((await quote(bruno, rows[0].id)).status).toBe(409);
    expect((await api().post('/api/posts').set(bruno.auth).send({ text: 'x', reply_to_id: orig.id, quote_of_id: orig.id })).status).toBe(400);
    await api().post('/api/users/bruno/block').set(ana.auth);
    expect((await quote(bruno, orig.id)).status).toBe(403);
    const removed = await post(carla, 'vai sair do ar');
    await query('UPDATE posts SET removed_at = now() WHERE id = $1', [removed.id]);
    expect((await quote(bruno, removed.id)).status).toBe(404);
  });

  it('se o original some ou é de quem a pessoa bloqueou, a citação fica sem ele', async () => {
    const orig = await post(ana, 'original');
    const q = (await quote(bruno, orig.id, 'minha citação')).body.data;
    await api().post('/api/users/ana/block').set(carla.auth);
    const seen = (await api().get(`/api/posts/${q.id}`).set(carla.auth)).body;
    expect(seen.data.text).toBe('minha citação');
    expect(seen.includes.posts.map((x) => x.id)).not.toContain(orig.id);
    await api().delete(`/api/posts/${orig.id}`).set(ana.auth);
    expect((await api().get(`/api/posts/${q.id}`).set(bruno.auth)).body.data.referenced_posts).toEqual([]);
  });
});
