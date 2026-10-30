import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { api, post, resetDb, signup } from './helpers.js';

const list = async (who, qs = '') => (await api().get(`/api/notificacoes${qs}`).set(who.auth)).body;
const kinds = async (who) => (await list(who)).data.map((n) => n.kind);

describe('notificações', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('exige login', async () => {
    expect((await api().get('/api/notificacoes')).status).toBe(401);
    expect((await api().get('/api/notificacoes/nao-lidas')).status).toBe(401);
    expect((await api().post('/api/notificacoes/lidas')).status).toBe(401);
  });

  it('curtir, repostar, responder, mencionar, seguir e recompensar viram avisos, do mais novo ao mais antigo', async () => {
    const p = await post(ana, 'meu post');
    await api().post(`/api/posts/${p.id}/like`).set(bruno.auth);
    await api().post(`/api/posts/${p.id}/repost`).set(bruno.auth);
    const r = await post(bruno, 'Concordo!', p.id);
    await post(carla, 'olá @ana e @bruno');
    await api().post('/api/users/ana/follow').set(carla.auth);
    expect((await api().post(`/api/posts/${p.id}/recompensa`).set(carla.auth)).status).toBe(200);

    const body = await list(ana);
    expect(body.data.map((n) => n.kind)).toEqual(['tip', 'follow', 'mention', 'reply', 'repost', 'like']);
    expect(body.meta.unread_count).toBe(6);
    const reply = body.data.find((n) => n.kind === 'reply');
    expect(reply.post_id).toBe(r.id);
    expect(body.data.find((n) => n.kind === 'follow').post_id).toBeNull();
    // Quem agiu e os posts vêm em includes, para a tela não precisar de outro pedido.
    expect(body.includes.users.map((u) => u.username).sort()).toEqual(expect.arrayContaining(['bruno', 'carla']));
    expect(body.includes.posts.map((x) => x.id)).toEqual(expect.arrayContaining([p.id, r.id]));
    // Bruno foi mencionado por Carla.
    expect(await kinds(bruno)).toEqual(['mention']);
  });

  it('ninguém é avisado da própria ação; quem é respondido e citado recebe um aviso só', async () => {
    const p = await post(ana, 'meu post');
    await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    await post(ana, 'eu mesma @ana');
    await post(bruno, '@ana respondendo e citando', p.id);
    expect(await kinds(ana)).toEqual(['reply']);
  });

  it('a mesma curtida não avisa duas vezes, e desfazer a ação apaga o aviso', async () => {
    const p = await post(ana, 'meu post');
    await api().post(`/api/posts/${p.id}/like`).set(bruno.auth);
    await api().post(`/api/posts/${p.id}/like`).set(bruno.auth);
    expect(await kinds(ana)).toEqual(['like']);
    await api().delete(`/api/posts/${p.id}/like`).set(bruno.auth);
    await api().post('/api/users/ana/follow').set(bruno.auth);
    await api().delete('/api/users/ana/follow').set(bruno.auth);
    await api().post(`/api/posts/${p.id}/repost`).set(bruno.auth);
    await api().delete(`/api/posts/${p.id}/repost`).set(bruno.auth);
    expect(await kinds(ana)).toEqual([]);
  });

  it('silenciar ou bloquear corta os avisos novos e esconde os antigos; post apagado leva o aviso junto', async () => {
    const p = await post(ana, 'meu post');
    await api().post(`/api/posts/${p.id}/like`).set(bruno.auth);
    await api().post(`/api/posts/${p.id}/like`).set(carla.auth);
    await api().post('/api/users/bruno/mute').set(ana.auth);
    await api().post('/api/users/ana/follow').set(bruno.auth);
    const body = await list(ana);
    expect(body.data.map((n) => [n.kind, n.actor_id])).toEqual([['like', carla.user.id]]);
    expect(body.meta.unread_count).toBe(1);

    await api().post('/api/users/carla/block').set(ana.auth);
    expect(await kinds(ana)).toEqual([]);

    const q = await post(ana, 'outro post');
    await api().post(`/api/posts/${q.id}/repost`).set(bruno.auth);
    await api().delete('/api/users/bruno/mute').set(ana.auth);
    await api().post(`/api/posts/${q.id}/like`).set(bruno.auth);
    expect(await kinds(ana)).toEqual(['like', 'like']); // o repost veio silenciado e não foi gravado
    await api().delete(`/api/posts/${q.id}`).set(ana.auth);
    expect(await kinds(ana)).toEqual(['like']);
  });

  it('marcar como lidas respeita o que a pessoa viu (newest_id) e o contador acompanha', async () => {
    const p = await post(ana, 'meu post');
    await api().post(`/api/posts/${p.id}/like`).set(bruno.auth);
    const seen = (await list(ana)).meta.newest_id;
    await api().post(`/api/posts/${p.id}/like`).set(carla.auth); // chega depois de abrir a tela
    const res = await api().post('/api/notificacoes/lidas').set(ana.auth).send({ newest_id: seen });
    expect(res.body).toEqual({ unread_count: 1 });
    expect((await api().get('/api/notificacoes/nao-lidas').set(ana.auth)).body).toEqual({ unread_count: 1 });
    expect((await list(ana)).data.map((n) => n.read)).toEqual([false, true]);
    await api().post('/api/notificacoes/lidas').set(ana.auth).send({});
    expect((await api().get('/api/notificacoes/nao-lidas').set(ana.auth)).body.unread_count).toBe(0);
    expect((await api().post('/api/notificacoes/lidas').set(ana.auth).send({ newest_id: 'x' })).status).toBe(400);
  });

  it('pagina com until_id (next_token) e some quando quem agiu é suspenso', async () => {
    const p = await post(ana, 'meu post');
    const fans = await Promise.all([1, 2, 3].map((i) => signup(`fa_${i}`)));
    for (const f of fans) await api().post(`/api/posts/${p.id}/like`).set(f.auth);
    const first = await list(ana, '?max_results=2');
    expect(first.data).toHaveLength(2);
    const second = await list(ana, `?max_results=2&until_id=${first.meta.next_token}`);
    expect(second.data).toHaveLength(1);
    await query('UPDATE users SET suspended_at = now() WHERE id = $1', [fans[0].user.id]);
    expect((await list(ana)).data).toHaveLength(2);
  });
});
