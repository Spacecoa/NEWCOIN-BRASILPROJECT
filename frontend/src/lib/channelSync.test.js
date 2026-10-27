import { describe, expect, it } from 'vitest';
import { applyDifference, applyIncoming, mergeReactions } from './channelSync.js';

const m = (pts) => ({ id: `m${pts}`, pts });

describe('sincronização por pts', () => {
  const state = { messages: [m(1), m(2)], lastPts: 2 };

  it('anexa a mensagem seguinte', () => {
    const r = applyIncoming(state, m(3));
    expect(r.gap).toBe(false);
    expect(r.state.lastPts).toBe(3);
    expect(r.state.messages).toHaveLength(3);
  });

  it('ignora duplicatas', () => {
    expect(applyIncoming(state, m(2))).toEqual({ state, gap: false });
  });

  it('detecta lacuna', () => {
    expect(applyIncoming(state, m(5)).gap).toBe(true);
  });

  it('applyDifference preenche a lacuna sem duplicar', () => {
    const next = applyDifference(state, [m(2), m(3), m(4)], 4);
    expect(next.messages.map((x) => x.pts)).toEqual([1, 2, 3, 4]);
    expect(next.lastPts).toBe(4);
  });

  it('mergeReactions preserva o "reagi" local', () => {
    const merged = mergeReactions([{ emoji: '🔥', count: 1, reacted: true }], [{ emoji: '🔥', count: 2 }, { emoji: '👍', count: 1 }]);
    expect(merged).toEqual([
      { emoji: '🔥', count: 2, reacted: true },
      { emoji: '👍', count: 1, reacted: false },
    ]);
  });
});
