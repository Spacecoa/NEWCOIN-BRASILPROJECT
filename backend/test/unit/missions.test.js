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

  it('no máximo 4 por dia, só entre as aplicáveis', () => {
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

  it('catálogo: toda missão tem recompensa fixa, porquê e é feita dentro do app', async () => {
    const { MAX_DAILY_REWARD } = await import('../../src/lib/missions.js');
    for (const [id, m] of Object.entries(CATALOG)) {
      expect(m.reward, id).toBeGreaterThan(0);
      expect(['engajamento', 'rede']).toContain(m.family);
      expect(m.why.length).toBeGreaterThan(20);
      expect(`${m.title} ${m.description}`).not.toMatch(/visite|vá até|encontre pessoalmente|compre|foto de|endereço|caminhe/i);
      if (m.family === 'engajamento') expect(m.target).toBeGreaterThan(0);
    }
    expect(MAX_DAILY_REWARD).toBe(13); // 2 de engajamento (3 + 2) + 2 de rede (4 + 4)
    expect(PRINCIPLES.join(' ')).toMatch(/Sem sequências e sem ranking individual/);
  });

  it('sempre 2 de engajamento e 2 de rede quando há opções suficientes', () => {
    for (let i = 0; i < 20; i++) {
      const r = selectMissions(String(i), '2026-10-27', MISSION_IDS);
      expect(r.filter((id) => CATALOG[id].family === 'engajamento')).toHaveLength(2);
      expect(r.filter((id) => CATALOG[id].family === 'rede')).toHaveLength(2);
    }
  });
});
