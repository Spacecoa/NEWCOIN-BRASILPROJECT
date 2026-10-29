import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { evaporate, remainingAfter, resetActivityMemory } from '../src/services/evaporation.js';
import { api, post, resetDb, signup } from './helpers.js';

// Evaporação do NWC: sem usar o app, o saldo cai aos poucos e zera em 7 dias.

beforeEach(async () => {
  await resetDb();
  resetActivityMemory();
});

const balance = async (who) => (await query('SELECT balance FROM token_balances WHERE user_id = $1', [who.user.id])).rows[0].balance;
async function wallet(who, amount) {
  await api().get('/api/carteira').set(who.auth); // cria a carteira (3 de boas-vindas)
  await query('UPDATE token_balances SET balance = $2 WHERE user_id = $1', [who.user.id, amount]);
}
const idleFor = (who, days) => query("UPDATE users SET last_active_at = now() - make_interval(days => $2) WHERE id = $1", [who.user.id, days]);

describe('evaporação do NWC', () => {
  it('a conta é uma reta: 7 → 6 → 5 … → 0, e nada passa do 7º dia', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => remainingAfter(7, 0, d))).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(remainingAfter(70, 0, 3)).toBe(40);
    expect(remainingAfter(70, 3, 7)).toBe(0);
    expect(remainingAfter(5, 0, 30)).toBe(0);
  });

  it('cada dia parado leva uma parte; o extrato registra; no 7º dia zera', async () => {
    const ana = await signup('ana');
    await wallet(ana, 14);
    await idleFor(ana, 3);
    await evaporate();
    expect(await balance(ana)).toBe(8);
    await evaporate(); // rodar de novo no mesmo dia não desconta duas vezes
    expect(await balance(ana)).toBe(8);
    await idleFor(ana, 7);
    await evaporate();
    expect(await balance(ana)).toBe(0);
    const { rows } = await query("SELECT amount, ref FROM token_ledger WHERE user_id = $1 AND kind = 'evaporated' ORDER BY id", [ana.user.id]);
    expect(rows).toEqual([{ amount: -6, ref: 'inatividade:3d' }, { amount: -8, ref: 'inatividade:7d' }]);
  });

  it('quem usa o app não perde nada; voltar para a evaporação, mas o que evaporou não volta', async () => {
    const ana = await signup('ana');
    await wallet(ana, 7);
    await evaporate();
    expect(await balance(ana)).toBe(7);

    await idleFor(ana, 2);
    resetActivityMemory();
    const w = await api().get('/api/carteira').set(ana.auth); // voltou: desconta os 2 dias e para
    expect(w.body.balance).toBe(5);
    expect(w.body.totals.evaporated).toBe(2);
    expect(w.body.ledger[0]).toMatchObject({ kind: 'evaporated', amount: -2 });
    await evaporate();
    expect(await balance(ana)).toBe(5);
  });

  it('token recebido durante a inatividade também evapora', async () => {
    const ana = await signup('ana');
    const bruno = await signup('bruno');
    await wallet(ana, 0);
    await idleFor(ana, 6);
    await evaporate();
    const p = await post(ana, 'post antigo da Ana');
    await idleFor(ana, 6); // o post acima marcou uso; volta a ficar parada
    await evaporate();
    await api().get('/api/carteira').set(bruno.auth);
    await api().post(`/api/posts/${p.id}/recompensa`).set(bruno.auth);
    expect(await balance(ana)).toBe(1);
    await idleFor(ana, 7);
    await evaporate();
    expect(await balance(ana)).toBe(0);
  });

  it('as regras públicas do token explicam a evaporação', async () => {
    const res = await api().get('/api/token');
    expect(res.body).toMatchObject({ evaporation_days: 7, evaporacao: expect.stringMatching(/7 dias/) });
  });
});
