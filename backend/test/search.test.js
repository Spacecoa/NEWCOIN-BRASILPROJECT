import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { api, post, resetDb, signup } from './helpers.js';

const search = (q, who, extra = '') => {
  const r = api().get(`/api/posts/busca?q=${encodeURIComponent(q)}${extra}`);
  return who ? r.set(who.auth) : r;
};
const texts = async (q, who) => (await search(q, who)).body.data.map((p) => p.text);

describe('busca de posts', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
  });

  it('acha por palavra sem diferença de acento nem de maiúsculas, e pelo radical', async () => {
    await post(bruno, 'O ônibus da linha 12 atrasou de novo');
    await post(bruno, 'Reunião para organizar a horta comunitária');
    await post(carla, 'Postgres com índices GIN');
    expect(await texts('onibus')).toEqual(['O ônibus da linha 12 atrasou de novo']);
    expect(await texts('ÔNIBUS')).toEqual(['O ônibus da linha 12 atrasou de novo']);
    expect(await texts('comunitárias')).toEqual(['Reunião para organizar a horta comunitária']);
    expect(await texts('organizando')).toEqual(['Reunião para organizar a horta comunitária']);
    expect(await texts('indice')).toEqual(['Postgres com índices GIN']);
    expect(await texts('futebol')).toEqual([]);
  });

  it('mais recentes primeiro, sem ordenar por curtidas; aspas, exclusão e OR funcionam', async () => {
    const velho = await post(bruno, 'horta no bairro, mutirão sábado');
    await post(carla, 'horta comunitária: quem leva mudas?');
    for (const who of [ana, carla]) await api().post(`/api/posts/${velho.id}/like`).set(who.auth);
    expect(await texts('horta')).toEqual(['horta comunitária: quem leva mudas?', 'horta no bairro, mutirão sábado']);
    expect(await texts('"horta no bairro"')).toEqual(['horta no bairro, mutirão sábado']);
    expect(await texts('horta -mudas')).toEqual(['horta no bairro, mutirão sábado']);
    expect((await texts('mudas OR mutirão')).length).toBe(2);
  });

  it('é aberta a visitantes, mas tira reposts, removidos, suspensos e quem tem bloqueio', async () => {
    const p = await post(bruno, 'assembleia do bairro amanhã');
    await api().post(`/api/posts/${p.id}/repost`).set(carla.auth);
    const removido = await post(carla, 'assembleia cancelada (golpe)');
    await query('UPDATE posts SET removed_at = now() WHERE id = $1', [removido.id]);
    expect((await search('assembleia')).body.data.map((x) => x.id)).toEqual([p.id]); // visitante, e o repost não duplica
    await api().post('/api/users/bruno/block').set(ana.auth);
    expect(await texts('assembleia', ana)).toEqual([]);
    await query('UPDATE users SET suspended_at = now() WHERE id = $1', [bruno.user.id]);
    expect(await texts('assembleia')).toEqual([]);
  });

  it('pagina com until_id e valida o tamanho da busca', async () => {
    for (let i = 0; i < 5; i++) await post(bruno, `mutirão número ${i}`);
    const first = (await search('mutirão', null, '&max_results=2')).body;
    expect(first.data).toHaveLength(2);
    expect(first.meta).toMatchObject({ result_count: 2, query: 'mutirão' });
    const rest = (await search('mutirão', null, `&max_results=10&until_id=${first.meta.next_token}`)).body;
    expect(rest.data).toHaveLength(3);
    expect((await search('a')).status).toBe(400);
    expect((await search('x'.repeat(101))).status).toBe(400);
    expect((await api().get('/api/posts/busca')).status).toBe(400);
    // Pontuação solta não quebra a consulta (websearch_to_tsquery aceita qualquer texto).
    expect((await search('!!! & | ( ) :*')).status).toBe(200);
  });
});
