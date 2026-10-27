import { describe, expect, it } from 'vitest';
import { relativeTime } from './time.js';

const now = new Date('2026-10-27T12:00:00Z');
const ago = (ms) => new Date(now.getTime() - ms);

describe('relativeTime', () => {
  it.each([
    [10_000, 'agora'],
    [5 * 60_000, '5 min'],
    [3 * 3600_000, '3 h'],
    [2 * 86400_000, '2 d'],
  ])('%i ms atrás => %s', (ms, expected) => {
    expect(relativeTime(ago(ms), now)).toBe(expected);
  });

  it('usa data curta depois de uma semana', () => {
    expect(relativeTime(ago(20 * 86400_000), now)).toMatch(/7 de out/);
    expect(relativeTime(new Date('2024-03-01T12:00:00Z'), now)).toMatch(/2024/);
  });
});
