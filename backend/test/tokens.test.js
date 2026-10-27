import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { rewardMission } from '../src/services/tokens.js';
import { api, post, resetDb, signup } from './helpers.js';

const age = (who) => query("UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1", [who.user.id]);
const wallet = async (who) => (await api().get('/api/carteira').set(who.auth)).body;
const tip = (who, postId) => api().post(`/api/posts/${postId}/recompensa`).set(who.auth);

/** Invariante contábil: o saldo de cada carteira é a soma do seu extrato. */
async function expectLedgerConsistent() {
  const { rows } = await query(
    `SELECT b.user_id, b.balance, COALESCE((SELECT sum(amount) FROM token_ledger l WHERE l.user_id = b.user_id), 0)::int AS sum
     FROM token_balances b`,
  );
  for (const r of rows) expect(r.balance, `carteira ${r.user_id}`).toBe(r.sum);
}

describe('token interno', () => {
  let ana, bruno, carla;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla] = await Promise.all([signup('ana'), signup('bruno'), signup('carla')]);
    await Promise.all([age(ana), age(bruno), age(carla)]);
  });

  it('regras públicas: utilidade nula, sem valor monetário', async () => {
    const res = await api().get('/api/token');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'NewCoin', symbol: 'NWC', tip_amount: 1 });
    expect(res.body.utilidade).toMatch(/Nenhuma por enquanto/);
    expect(res.body.nao_e).toEqual(expect.arrayContaining(['dinheiro', 'criptomoeda']));
  });

  it('carteira nasce com o saldo de boas-vindas, uma única vez', async () => {
    expect((await api().get('/api/carteira')).status).toBe(401);
    const w = await wallet(ana);
    expect(w.balance).toBe(3);
    expect(w.ledger).toHaveLength(1);
    expect(w.ledger[0]).toMatchObject({ amount: 3, kind: 'grant' });
    expect((await wallet(ana)).balance).toBe(3);
    await expectLedgerConsistent();
  });

  it('recompensar transfere 1 token ao autor, como um like: uma vez por post', async () => {
    const p = await post(bruno, 'Post que valeu a leitura');
    const res = await tip(ana, p.id);
    expect(res.status).toBe(200);
    expect(res.body.data.public_metrics.tip_count).toBe(1);
    expect(res.body.data.viewer.tipped).toBe(true);
    expect((await tip(ana, p.id)).body.data.public_metrics.tip_count).toBe(1); // repetir não cobra de novo

    const a = await wallet(ana);
    const b = await wallet(bruno);
    expect(a.balance).toBe(2);
    expect(b.balance).toBe(4);
    expect(a.ledger[0]).toMatchObject({ kind: 'tip_sent', amount: -1, counterpart: 'bruno', post_id: p.id });
    expect(b.ledger[0]).toMatchObject({ kind: 'tip_received', amount: 1, counterpart: 'ana', post_id: p.id });
    expect(b.totals).toMatchObject({ received: 1, given: 0 });
    await expectLedgerConsistent();
  });

  it('não cria token: recompensas em círculo não aumentam o total', async () => {
    const pa = await post(ana, 'da ana');
    const pb = await post(bruno, 'do bruno');
    await tip(ana, pb.id);
    await tip(bruno, pa.id);
    const total = (await query('SELECT sum(balance)::int AS t FROM token_balances')).rows[0].t;
    expect(total).toBe(6); // 3 + 3 de boas-vindas
    await expectLedgerConsistent();
  });

  it('recusa recompensar o próprio post e quando falta saldo', async () => {
    const mine = await post(ana, 'meu');
    expect((await tip(ana, mine.id)).status).toBe(409);
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await post(bruno, `post ${i}`));
    for (let i = 0; i < 3; i++) expect((await tip(ana, ps[i].id)).status).toBe(200);
    const broke = await tip(ana, ps[3].id);
    expect(broke.status).toBe(409);
    expect(broke.body.error).toMatch(/Saldo insuficiente de NWC/);
    expect((await wallet(ana)).balance).toBe(0);
    const { rows } = await query('SELECT count(*)::int AS n FROM tips WHERE user_id = $1', [ana.user.id]);
    expect(rows[0].n).toBe(3); // a tentativa sem saldo não deixou rastro
    await expectLedgerConsistent();
  });

  it('recompensar um repost paga o autor do original', async () => {
    const p = await post(carla, 'original da carla');
    await api().post(`/api/posts/${p.id}/repost`).set(bruno.auth);
    const repostId = (await api().get('/api/users/bruno/posts')).body.data[0].id;
    await tip(ana, repostId);
    expect((await wallet(carla)).balance).toBe(4);
    expect((await wallet(bruno)).balance).toBe(3);
  });

  it('limite diário de recompensas', async () => {
    await wallet(ana);
    await query('UPDATE token_balances SET balance = 100 WHERE user_id = $1', [ana.user.id]);
    const ps = [];
    for (let i = 0; i < 21; i++) ps.push(await post(bruno, `p${i}`));
    for (let i = 0; i < 20; i++) expect((await tip(ana, ps[i].id)).status).toBe(200);
    const over = await tip(ana, ps[20].id);
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/Limite de 20/);
  });

  it('recompensa de missão é creditada uma única vez por dia', async () => {
    expect(await rewardMission(ana.user.id, '2026-10-27', 'curtir', 2)).toBe(true);
    expect(await rewardMission(ana.user.id, '2026-10-27', 'curtir', 2)).toBe(false);
    expect(await rewardMission(ana.user.id, '2026-10-28', 'curtir', 2)).toBe(true);
    const w = await wallet(ana);
    expect(w.balance).toBe(7);
    expect(w.totals.from_missions).toBe(4);
    expect(w.ledger[0]).toMatchObject({ kind: 'mission', mission: 'curtir' });
    await expectLedgerConsistent();
  });
});

describe('missões de engajamento (dentro do app)', () => {
  let ana, bruno, carla, diego, done, progress;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno, carla, diego] = await Promise.all([signup('ana'), signup('bruno'), signup('carla'), signup('diego')]);
    await Promise.all([ana, bruno, carla, diego].map(age));
    const svc = await import('../src/services/missions.js');
    done = svc.__test.done;
    progress = svc.__test.progress;
  });

  it('curtir: 5 curtidas de pelo menos 3 pessoas diferentes', async () => {
    const own = [];
    for (let i = 0; i < 5; i++) own.push(await post(bruno, `b${i}`));
    for (const p of own) await api().post(`/api/posts/${p.id}/like`).set(ana.auth);
    expect(await progress('curtir', ana)).toMatchObject({ current: 5, target: 5, extra: { authors: 1 } });
    expect(await done('curtir', ana)).toBe(false); // todas do mesmo autor
    for (const who of [carla, diego]) await api().post(`/api/posts/${(await post(who, 'oi')).id}/like`).set(ana.auth);
    expect(await done('curtir', ana)).toBe(true);
  });

  it('curtir os próprios posts não conta', async () => {
    for (let i = 0; i < 5; i++) await api().post(`/api/posts/${(await post(ana, `a${i}`)).id}/like`).set(ana.auth);
    expect((await progress('curtir', ana)).current).toBe(0);
  });

  it('republicar: 2 reposts de outras pessoas', async () => {
    for (const who of [bruno, carla]) await api().post(`/api/posts/${(await post(who, 'bom')).id}/repost`).set(ana.auth);
    expect(await done('republicar', ana)).toBe(true);
  });

  it('comentar: 3 respostas com pelo menos 15 caracteres em posts de outras pessoas', async () => {
    const p = await post(bruno, 'O que acham de Postgres?');
    await post(ana, 'ok', p.id); // curto demais
    await post(ana, 'Eu acho ótimo para dados relacionais', p.id);
    await post(ana, 'Também uso índices parciais sempre', p.id);
    expect((await progress('comentar', ana)).current).toBe(2);
    await post(ana, 'E o JSONB resolve muita coisa também', p.id);
    expect(await done('comentar', ana)).toBe(true);
  });

  it('recompensar: dar 1 token a alguém', async () => {
    await api().post(`/api/posts/${(await post(bruno, 'valeu')).id}/recompensa`).set(ana.auth);
    expect(await done('recompensar', ana)).toBe(true);
  });

  it('tempo no app: 1 minuto por sinal a cada 55 s, limite diário, e pode ser desligado', async () => {
    const beat = () => api().post('/api/atividade').set(ana.auth);
    expect((await beat()).body).toEqual({ counted: true, minutes: 1 });
    expect((await beat()).body.minutes).toBe(1); // sinais rápidos demais são ignorados
    await query("UPDATE activity_days SET last_beat_at = now() - interval '2 minutes', minutes = 9 WHERE user_id = $1", [ana.user.id]);
    expect((await beat()).body.minutes).toBe(10);
    expect(await done('tempo_no_app', ana)).toBe(true);
    await query("UPDATE activity_days SET last_beat_at = now() - interval '2 minutes', minutes = 120 WHERE user_id = $1", [ana.user.id]);
    expect((await beat()).body.minutes).toBe(120); // teto diário

    await api().put('/api/feed/preferencias').set(bruno.auth).send({ count_time: false });
    expect((await api().post('/api/atividade').set(bruno.auth)).body).toEqual({ counted: false, minutes: 0 });
    const m = (await api().get('/api/missoes').set(bruno.auth)).body;
    expect(m.missions.map((x) => x.id)).not.toContain('tempo_no_app');
  });

  it('ao concluir as missões sorteadas, o token é creditado uma vez e aparece no saldo', async () => {
    // cumpre TODAS as missões de engajamento, qualquer que seja o sorteio
    const authors = [bruno, carla, diego];
    for (let i = 0; i < 6; i++) await api().post(`/api/posts/${(await post(authors[i % 3], `post ${i}`)).id}/like`).set(ana.auth);
    for (const who of [bruno, carla]) await api().post(`/api/posts/${(await post(who, 'para repostar')).id}/repost`).set(ana.auth);
    const target = await post(diego, 'Pergunta aberta: qual banco vocês usam?');
    for (let i = 0; i < 3; i++) await post(ana, `Comentário útil número ${i} aqui`, target.id);
    await api().post(`/api/posts/${target.id}/recompensa`).set(ana.auth);
    await query("INSERT INTO activity_days (user_id, day, minutes) VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 12)", [ana.user.id]);

    const first = (await api().get('/api/missoes').set(ana.auth)).body;
    const eng = first.missions.filter((m) => m.family === 'engajamento');
    expect(eng.every((m) => m.status === 'done')).toBe(true);
    const expected = first.missions.filter((m) => m.status === 'done').reduce((s, m) => s + m.reward, 0);
    expect(first.token.earned_now).toBe(expected);
    expect(first.token.earned_today).toBe(expected);
    expect(first.token.balance).toBe(3 - 1 + expected); // boas-vindas − recompensa dada + missões

    const second = (await api().get('/api/missoes').set(ana.auth)).body;
    expect(second.token).toMatchObject({ earned_now: 0, balance: first.token.balance });
    await expectLedgerConsistent();
  });
});
