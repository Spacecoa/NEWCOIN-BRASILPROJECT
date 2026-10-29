import { query, withTransaction } from '../db.js';
import { nextId } from '../lib/ids.js';

// Evaporação do NWC (decisão do projeto contra contas falsas que juntam token).
//
// Cada dia inteiro sem usar o app leva uma parte do saldo, até zerar no 7º dia:
//   dia 1 leva 1/7 do que havia, dia 2 leva 1/6 do que sobrou, ..., dia 7 leva o resto.
// Sem entradas no meio, é uma queda em linha reta: 7 → 6 → 5 → ... → 0.
// Token recebido durante a inatividade também evapora nos dias seguintes.
// Usar o app (qualquer pedido logado) para a evaporação; o que já evaporou não volta.
// O token evaporado sai de circulação: não vai para ninguém.

export const EVAPORATION = Object.freeze({ days: 7 });
const DAY_MS = 86_400_000;

/** Saldo que sobra depois de descontar os dias de inatividade de `fromDay`+1 até `toDay`. */
export function remainingAfter(balance, fromDay, toDay, days = EVAPORATION.days) {
  let b = balance;
  for (let d = fromDay + 1; d <= Math.min(toDay, days); d++) b = Math.floor((b * (days - d)) / (days - d + 1));
  return b;
}

/**
 * Desconta os dias de inatividade ainda não descontados. Sem userId, faz para todo mundo
 * (rotina periódica). Devolve [{ user_id, burned, days }].
 */
export async function evaporate({ userId = null, now = new Date() } = {}) {
  const { rows } = await query(
    `SELECT b.user_id FROM token_balances b JOIN users u ON u.id = b.user_id
      WHERE u.last_active_at < $1 AND b.evaporated_days < $2 AND ($3::bigint IS NULL OR b.user_id = $3)`,
    [new Date(now.getTime() - DAY_MS), EVAPORATION.days, userId],
  );
  const out = [];
  for (const { user_id: id } of rows) {
    const r = await withTransaction(async (c) => {
      const { rows: s } = await c.query(
        `SELECT b.balance, b.evaporated_days, u.last_active_at FROM token_balances b JOIN users u ON u.id = b.user_id
          WHERE b.user_id = $1 FOR UPDATE OF b`,
        [id],
      );
      if (!s[0]) return null;
      const idle = Math.min(EVAPORATION.days, Math.floor((now.getTime() - new Date(s[0].last_active_at).getTime()) / DAY_MS));
      if (idle <= s[0].evaporated_days) return null;
      const left = remainingAfter(s[0].balance, s[0].evaporated_days, idle);
      const burned = s[0].balance - left;
      await c.query('UPDATE token_balances SET balance = $2, evaporated_days = $3, updated_at = now() WHERE user_id = $1', [id, left, idle]);
      if (burned > 0) {
        await c.query("INSERT INTO token_ledger (id, user_id, amount, kind, ref) VALUES ($1, $2, $3, 'evaporated', $4)", [
          nextId(),
          id,
          -burned,
          `inatividade:${idle}d`,
        ]);
      }
      return { user_id: id, burned, days: idle };
    });
    if (r) out.push(r);
  }
  return out;
}

// Marca o uso do app. Para não escrever a cada pedido, grava no máximo a cada 5 minutos
// por pessoa (por processo). Antes de marcar a volta, desconta o que estava pendente.
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const lastTouch = new Map();

export async function touchActivity(userId, now = new Date()) {
  const key = String(userId);
  const prev = lastTouch.get(key);
  if (prev && now.getTime() - prev < TOUCH_EVERY_MS) return;
  lastTouch.set(key, now.getTime());
  if (lastTouch.size > 50_000) lastTouch.clear();
  await evaporate({ userId: key, now });
  await query('UPDATE users SET last_active_at = $2 WHERE id = $1', [key, now]);
  await query('UPDATE token_balances SET evaporated_days = 0 WHERE user_id = $1 AND evaporated_days <> 0', [key]);
}

export function resetActivityMemory() {
  lastTouch.clear();
}

let timer = null;
/** Rotina periódica (de hora em hora): ninguém precisa abrir o app para o saldo evaporar. */
export function startEvaporationLoop({ minutes = 60, log = console.log } = {}) {
  if (timer) return;
  const run = () =>
    evaporate()
      .then((r) => r.length && log(`[nwc] evaporação: ${r.reduce((a, x) => a + x.burned, 0)} NWC de ${r.length} conta(s) inativa(s)`))
      .catch((e) => log('[nwc] falha na evaporação:', e.message));
  timer = setInterval(run, minutes * 60_000);
  timer.unref?.();
  setTimeout(run, 10_000).unref?.();
}
