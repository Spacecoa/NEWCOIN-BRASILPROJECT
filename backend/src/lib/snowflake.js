// Gerador de IDs no estilo Snowflake (publicado pelo Twitter em 2010):
//   41 bits de timestamp (ms desde EPOCH) | 10 bits de worker | 12 bits de sequência
// Propriedades úteis: únicos sem coordenação central (cada instância federada usa
// seu WORKER_ID) e ordenáveis por tempo — base da paginação por cursor.

export const EPOCH = 1704067200000n; // 2024-01-01T00:00:00Z

export function createSnowflake(workerId = 1, now = () => Date.now()) {
  if (!Number.isInteger(workerId) || workerId < 0 || workerId > 1023) {
    throw new RangeError('workerId deve estar entre 0 e 1023');
  }
  const worker = BigInt(workerId);
  let lastMs = -1n;
  let sequence = 0n;

  return function nextId() {
    let ms = BigInt(now());
    if (ms < lastMs) ms = lastMs; // relógio voltou: nunca gere IDs menores
    if (ms === lastMs) {
      sequence = (sequence + 1n) & 0xfffn;
      if (sequence === 0n) {
        // 4096 IDs no mesmo ms: avança para o próximo ms "virtual".
        ms = lastMs + 1n;
      }
    } else {
      sequence = 0n;
    }
    lastMs = ms;
    return (((ms - EPOCH) << 22n) | (worker << 12n) | sequence).toString();
  };
}

/** Extrai a data de criação de um Snowflake (útil para depuração). */
export function snowflakeToDate(id) {
  return new Date(Number((BigInt(id) >> 22n) + EPOCH));
}

/** Menor Snowflake possível para um instante — permite traduzir start_time em cursor. */
export function dateToSnowflake(date) {
  return ((BigInt(date.getTime()) - EPOCH) << 22n).toString();
}
