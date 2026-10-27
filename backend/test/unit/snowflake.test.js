import { describe, expect, it } from 'vitest';
import { createSnowflake, dateToSnowflake, EPOCH, snowflakeToDate } from '../../src/lib/snowflake.js';

describe('snowflake', () => {
  it('gera IDs estritamente crescentes mesmo no mesmo milissegundo', () => {
    const next = createSnowflake(7, () => 1_800_000_000_000);
    const ids = Array.from({ length: 5000 }, next).map(BigInt);
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nunca retrocede quando o relógio volta', () => {
    let t = 1_800_000_000_000;
    const next = createSnowflake(1, () => t);
    const a = BigInt(next());
    t -= 5000;
    expect(BigInt(next()) > a).toBe(true);
  });

  it('codifica o timestamp e o worker', () => {
    const ms = 1_800_000_000_123;
    const id = BigInt(createSnowflake(513, () => ms)());
    expect(snowflakeToDate(id).getTime()).toBe(ms);
    expect(Number((id >> 12n) & 0x3ffn)).toBe(513);
    expect(id >> 22n).toBe(BigInt(ms) - EPOCH);
  });

  it('workers diferentes nunca colidem', () => {
    const a = createSnowflake(1, () => 1_800_000_000_000);
    const b = createSnowflake(2, () => 1_800_000_000_000);
    expect(a()).not.toBe(b());
  });

  it('dateToSnowflake gera o menor ID daquele instante', () => {
    const d = new Date(1_800_000_000_000);
    const id = createSnowflake(1, () => d.getTime())();
    expect(BigInt(dateToSnowflake(d)) <= BigInt(id)).toBe(true);
  });

  it('rejeita worker fora do intervalo', () => {
    expect(() => createSnowflake(1024)).toThrow(RangeError);
  });
});
