import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { api, post, resetDb, signup } from './helpers.js';

// Torna a conta "veterana" (criada há 60 dias).
const age = (who) => query("UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1", [who.user.id]);
const missions = async (who) => (await api().get('/api/missoes').set(who.auth)).body;
const status = (body, id) => body.missions.find((m) => m.id === id)?.status;

describe('missões diárias', () => {
  let ana, bruno;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
    await age(ana);
    await age(bruno);
  });

  it('exige login, devolve no máximo 3 missões, painel coletivo e princípios', async () => {
    expect((await api().get('/api/missoes')).status).toBe(401);
    const body = await missions(ana);
    expect(body.enabled).toBe(true);
    expect(body.missions.length).toBeGreaterThan(0);
    expect(body.missions.length).toBeLessThanOrEqual(3);
    expect(body.collective).toMatchObject({ novos_membros_semana: 0, convites_aceitos_semana: 0 });
    expect(body.principles[0]).toMatch(/Sem pontos/);
    for (const m of body.missions) expect(m).toEqual(expect.objectContaining({ title: expect.any(String), why: expect.any(String), status: 'todo' }));
    expect(await missions(ana)).toEqual(body); // determinístico no mesmo dia
  });

  it('pessoa nova recebe "apresentar", que se cumpre com um post', async () => {
    const nina = await signup('nina');
    let body = await missions(nina);
    expect(body.missions[0].id).toBe('apresentar');
    await post(nina, 'Oi! Sou a Nina, estudo redes comunitárias.');
    body = await missions(nina);
    expect(status(body, 'apresentar')).toBe('done');
    expect(body.summary.done).toBeGreaterThanOrEqual(1);
    // quem já tinha postado em outro dia não recebe "apresentar"
    await query("UPDATE posts SET created_at = now() - interval '2 days' WHERE author_id = $1", [nina.user.id]);
    body = await missions(nina);
    expect(body.missions.map((m) => m.id)).not.toContain('apresentar');
  });

  it('boas-vindas: sugere quem chegou, conclui ao responder e o painel coletivo conta', async () => {
    const nina = await signup('nina');
    const hello = await post(nina, 'Primeiro post por aqui!');
    const { __test } = await import('../src/services/missions.js');
    expect((await __test.suggest('boas_vindas', ana)).map((s) => s.username)).toEqual(['nina']);
    expect(await __test.done('boas_vindas', ana)).toBe(false);
    expect((await missions(ana)).collective).toMatchObject({ novos_membros_semana: 1, recebidos_semana: 0 });

    await post(ana, 'Bem-vinda, @nina!', hello.id);
    expect(await __test.done('boas_vindas', ana)).toBe(true);
    expect(await __test.suggest('boas_vindas', ana)).toEqual([]); // já recebida por ana
    expect((await missions(ana)).collective.recebidos_semana).toBe(1);
  });

  it('responder pergunta só conta para a PRIMEIRA resposta', async () => {
    const q = await post(bruno, 'Alguém sabe configurar o Redis?');
    const carla = await signup('carla');
    await age(carla);
    const { __test } = await import('../src/services/missions.js');
    expect((await __test.suggest('responder_pergunta', ana)).map((s) => s.id)).toEqual([q.id]);
    await post(carla, 'Eu sei!', q.id);
    await post(ana, 'Também sei', q.id);
    expect(await __test.done('responder_pergunta', carla)).toBe(true);
    expect(await __test.done('responder_pergunta', ana)).toBe(false);
    expect((await missions(ana)).collective.perguntas_respondidas_hoje).toBe(1);
  });

  it('pular esconde sem custo; missão inexistente dá 404', async () => {
    const body = await missions(ana);
    const target = body.missions[0].id;
    expect((await api().post(`/api/missoes/${target}/pular`).set(ana.auth)).status).toBe(200);
    expect(status(await missions(ana), target)).toBe('skipped');
    expect((await api().post('/api/missoes/farmar_pontos/pular').set(ana.auth)).status).toBe(404);
  });

  it('pode ser desligado nas preferências', async () => {
    await api().put('/api/feed/preferencias').set(ana.auth).send({ missions_enabled: false });
    const body = await missions(ana);
    expect(body).toMatchObject({ enabled: false, missions: [] });
  });

  it('rotas desconhecidas em /api continuam 404 (não 401)', async () => {
    expect((await api().get('/api/nao-existe')).status).toBe(404);
  });
});

describe('verificação de cada missão por ações reais', () => {
  // Testa a regra de conclusão de todas as missões, independentemente de quais foram sorteadas.
  let ana, bruno;
  let done;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
    await age(ana);
    await age(bruno);
    const svc = await import('../src/services/missions.js');
    done = svc.__test.done;
  });

  it('ponte: seguir alguém que ninguém do seu círculo segue', async () => {
    const carla = await signup('carla');
    await post(carla, 'oi');
    expect(await done('ponte', ana)).toBe(false);
    await api().post('/api/users/carla/follow').set(ana.auth);
    expect(await done('ponte', ana)).toBe(true);
  });

  it('ponte não conta se alguém que você segue já segue a pessoa', async () => {
    const carla = await signup('carla');
    await api().post('/api/users/carla/follow').set(bruno.auth);
    await api().post('/api/users/bruno/follow').set(ana.auth);
    // ana já seguia bruno antes de hoje
    await query("UPDATE follows SET created_at = now() - interval '3 days' WHERE follower_id = $1", [ana.user.id]);
    expect(await done('ponte', ana)).toBe(false);
    await api().post('/api/users/carla/follow').set(ana.auth); // carla já é seguida por bruno
    expect(await done('ponte', ana)).toBe(false);
    expect(carla.user.username).toBe('carla');
  });

  it('amplificar: repostar quem tem menos de 5 seguidores', async () => {
    const p = await post(bruno, 'algo bom');
    expect(await done('amplificar', ana)).toBe(false);
    await api().post(`/api/posts/${p.id}/repost`).set(ana.auth);
    expect(await done('amplificar', ana)).toBe(true);
  });

  it('conversa coletiva e organizar: mensagem em grupo e criar grupo', async () => {
    expect(await done('organizar', ana)).toBe(false);
    await api().post('/api/channels').set(ana.auth).send({ slug: 'bairro', title: 'Bairro', kind: 'group' });
    expect(await done('organizar', ana)).toBe(true);
    expect(await done('conversa_coletiva', bruno)).toBe(false);
    await api().post('/api/channels/bairro/members').set(bruno.auth);
    await api().post('/api/channels/bairro/messages').set(bruno.auth).send({ text: 'Bora organizar a feira!' });
    expect(await done('conversa_coletiva', bruno)).toBe(true);
  });

  it('canal de broadcast não conta como "abrir um espaço" coletivo', async () => {
    await api().post('/api/channels').set(ana.auth).send({ slug: 'avisos', title: 'Avisos', kind: 'channel' });
    expect(await done('organizar', ana)).toBe(false);
  });
});

describe('convites', () => {
  let ana;
  beforeEach(async () => {
    await resetDb();
    ana = await signup('ana');
    await age(ana);
  });

  it('gera, lista, cadastra com convite (uma vez só) e a pessoa nova segue quem convidou', async () => {
    const created = await api().post('/api/convites').set(ana.auth);
    expect(created.status).toBe(201);
    const { code, path } = created.body.data;
    expect(code).toMatch(/^[a-z0-9]{8}$/);
    expect(path).toBe(`/cadastro?convite=${code}`);

    const reg = await api().post('/api/auth/register').send({ username: 'nina', email: 'nina@x.io', password: 'senha1234', invite_code: code.toUpperCase() });
    expect(reg.status).toBe(201);
    const following = await api().get('/api/users/nina/following');
    expect(following.body.data.map((u) => u.username)).toEqual(['ana']);

    const again = await api().post('/api/auth/register').send({ username: 'otavio', email: 'o@x.io', password: 'senha1234', invite_code: code });
    expect(again.status).toBe(400);
    expect((await api().get('/api/users/otavio')).status).toBe(404); // nada foi criado

    const list = await api().get('/api/convites').set(ana.auth);
    expect(list.body.data[0]).toMatchObject({ code, used: true, used_by_username: 'nina' });

    const m = await missions(ana);
    expect(m.collective.convites_aceitos_semana).toBe(1);
    const svc = await import('../src/services/missions.js');
    expect(await svc.__test.done('convidar', ana)).toBe(true);
  });

  it('código malformado é recusado e há limite de convites abertos', async () => {
    const bad = await api().post('/api/auth/register').send({ username: 'nina', email: 'n@x.io', password: 'senha1234', invite_code: 'x' });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await api().post('/api/convites').set(ana.auth)).status).toBe(201);
    expect((await api().post('/api/convites').set(ana.auth)).status).toBe(409);
  });
});
