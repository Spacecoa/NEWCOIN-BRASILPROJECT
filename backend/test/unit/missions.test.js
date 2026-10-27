import { describe, expect, it } from 'vitest';
import { CATALOG, hash, MISSION_IDS, MISSIONS_PER_DAY, PRINCIPLES, selectMissions } from '../../src/lib/missions.js';

describe('seleção das missões do dia', () => {
  const all = MISSION_IDS;

  it('é determinística: mesma pessoa e mesmo dia, mesmas missões', () => {
    expect(selectMissions('42', '2026-10-27', all)).toEqual(selectMissions('42', '2026-10-27', all));
    expect(hash('abc')).toBe(hash('abc'));
  });

  it('varia entre dias e entre pessoas', () => {
    const days = new Set(Array.from({ length: 10 }, (_, i) => selectMissions('42', `2026-11-${10 + i}`, all).join()));
    const people = new Set(Array.from({ length: 10 }, (_, i) => selectMissions(String(i), '2026-10-27', all).join()));
    expect(days.size).toBeGreaterThan(1);
    expect(people.size).toBeGreaterThan(1);
  });

  it('no máximo 3 por dia, só entre as aplicáveis', () => {
    const r = selectMissions('1', '2026-10-27', all);
    expect(r).toHaveLength(MISSIONS_PER_DAY);
    expect(selectMissions('1', '2026-10-27', ['convidar', 'ponte'])).toEqual(expect.arrayContaining(['convidar', 'ponte']));
    expect(selectMissions('1', '2026-10-27', ['convidar', 'ponte'])).toHaveLength(2);
    expect(selectMissions('1', '2026-10-27', ['inexistente'])).toEqual([]);
  });

  it('pessoa nova sempre começa por "apresentar"; veterana nunca recebe', () => {
    expect(selectMissions('7', '2026-10-27', all, { isNewUser: true })[0]).toBe('apresentar');
    for (let i = 0; i < 20; i++) expect(selectMissions(String(i), '2026-10-27', all)).not.toContain('apresentar');
  });

  it('catálogo explica o porquê de cada missão e não fala em pontos', () => {
    for (const m of Object.values(CATALOG)) {
      expect(m.why.length).toBeGreaterThan(20);
      expect(`${m.title} ${m.description}`).not.toMatch(/pontos?|xp|sequência/i);
    }
    expect(PRINCIPLES.join(' ')).toMatch(/Sem pontos, sem sequências e sem ranking/);
  });
});
