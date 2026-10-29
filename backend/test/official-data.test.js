import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { accumulate12, parseBcb, parseIbge, yearOverYear } from '../src/official/adapters.js';
import { REGISTRO } from '../src/official/registro.js';
import { allIndicators, indicator, loadRegistro, refreshAll } from '../src/official/service.js';
import { api, resetDb, signup } from './helpers.js';

// Respostas SINTÉTICAS no formato documentado de cada API (valores de teste, não dados reais).

/** Últimos n meses terminando no mês passado: ['AAAAMM', ...]. */
function months(n, endOffset = 1) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - endOffset);
  for (let i = 0; i < n; i++) {
    out.unshift(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
const quarters = (n) => {
  const out = [];
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  for (let i = 0; i < n; i++) {
    out.unshift(`${d.getFullYear()}0${Math.floor(d.getMonth() / 3) + 1}`);
    d.setMonth(d.getMonth() - 3);
  }
  return out;
};
const ibge = (name, entries) => [{ id: '1', variavel: name, unidade: '%', resultados: [{ classificacoes: [], series: [{ localidade: { id: '1', nome: 'Brasil' }, serie: Object.fromEntries(entries) }] }] }];
const bcb = (entries) => entries.map(([p, v]) => ({ data: `01/${p.slice(4)}/${p.slice(0, 4)}`, valor: String(v) }));
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });

function fakeFetch(overrides = {}) {
  const m = months(24);
  const q = quarters(8);
  const routes = {
    'agregados/1737': ibge('IPCA - Variação acumulada em 12 meses', m.map((p, i) => [p, (4 + i * 0.01).toFixed(2)])),
    'sgs.13522/': bcb(m.map((p, i) => [p, (4 + i * 0.01).toFixed(2)])),
    'sgs.1635/': bcb(m.map((p) => [p, '0.30'])),
    'agregados/6381': ibge('Taxa de desocupação, na semana de referência (%)', m.map((p, i) => [p, (8 - i * 0.05).toFixed(1)])),
    'sgs.24369/': bcb(m.map((p, i) => [p, (8 - i * 0.05).toFixed(1)])),
    'agregados/5932': ibge('Taxa trimestral (em relação ao mesmo período do ano anterior)', q.map((p) => [p, '2.0'])),
    'sgs.24363/': bcb(m.map((p, i) => [p, 100 + i])),
    'sgs.432/': bcb(m.map((p) => [p, '10.50'])),
    ...overrides,
  };
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, text: async () => 'not found' };
    return typeof hit[1] === 'function' ? hit[1](url) : ok(hit[1]);
  };
  return { impl, calls };
}

beforeEach(resetDb);

describe('leitores das fontes', () => {
  it('IBGE: lê o formato da API de agregados v3, ignora "..." e trimestres viram AAAATn', () => {
    const r = parseIbge(ibge('Taxa X', [['202401', '1.5'], ['202402', '...'], ['202403', '-0.2']]), { frequency: 'trimestral' });
    expect(r.name).toBe('Taxa X');
    expect(r.observations).toEqual([{ period: '2024T1', value: 1.5 }, { period: '2024T3', value: -0.2 }]);
    expect(() => parseIbge({ erro: 1 })).toThrow(/formato inesperado/);
  });

  it('Banco Central: lê dd/mm/aaaa e fica com o último valor de cada mês', () => {
    const r = parseBcb([{ data: '01/03/2024', valor: '10.5' }, { data: '20/03/2024', valor: '10.75' }, { data: '02/04/2024', valor: '10.75' }]);
    expect(r.observations).toEqual([{ period: '202403', value: 10.75 }, { period: '202404', value: 10.75 }]);
  });

  it('acumula 12 meses e calcula variação anual de índices', () => {
    const obs = Array.from({ length: 12 }, (_, i) => ({ period: `2024${String(i + 1).padStart(2, '0')}`, value: 1 }));
    expect(accumulate12(obs)).toEqual([{ period: '202412', value: 12.68 }]);
    expect(yearOverYear([{ period: '202301', value: 100 }, { period: '202401', value: 103 }])).toEqual([{ period: '202401', value: 3 }]);
  });
});

describe('coleta e verificação tripla', () => {
  it('guarda o original com hash, e cada indicador recebe o selo certo', async () => {
    const { impl, calls } = fakeFetch();
    const report = await refreshAll({ fetchImpl: impl });
    expect(report.filter((r) => r.ok)).toHaveLength(8);
    expect(report.find((r) => r.source === 'dieese_cesta_sp')).toMatchObject({ ok: false, pending: true });
    // Banco Central sempre com filtro de datas (obrigatório).
    expect(calls.filter((u) => u.includes('bcb.gov.br')).every((u) => u.includes('dataInicial=') && u.includes('dataFinal='))).toBe(true);
    const { rows } = await query("SELECT sha256, body FROM official_raw WHERE source_key = 'ibge_ipca_12m'");
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(rows[0].body)[0].variavel).toContain('12 meses');

    const res = await api().get('/api/dados');
    const by = Object.fromEntries(res.body.data.indicators.map((i) => [i.id, i]));
    expect(by.inflacao).toMatchObject({ badge: 'fonte_unica', checks: { origem: 'ok', consistencia: 'ok', independente: 'nao_existe' } });
    expect(by.emprego.badge).toBe('fonte_unica');
    expect(by.economia).toMatchObject({ badge: 'confirmado', checks: { independente: 'concorda' } });
    expect(by.juros.badge).toBe('fonte_unica');
    expect(by.juros.notes[0]).toMatch(/decisão do Banco Central/);
    // Cesta: a origem (DIEESE) ainda não está conectada; a fonte independente aparece mesmo assim.
    expect(by.comida.badge).toBe('sem_dados');
    expect(by.comida.notes[0]).toMatch(/DIEESE.*não conectada/);
    const alimentos = by.comida.sources.find((s) => s.key === 'bcb_ipca_alimentos');
    expect(alimentos.latest.value).toBeCloseTo(3.66, 1); // 12 × 0,30 % acumulado
    // Cada fonte mostra onde está o original.
    expect(by.inflacao.sources[0].original).toMatchObject({ url: expect.stringContaining('servicodados.ibge.gov.br'), sha256: expect.any(String) });
    expect(by.inflacao.history.length).toBeGreaterThan(12);
  });

  it('republicação que não bate com a origem vira "em divergência", com o período que diferiu', async () => {
    const m = months(24);
    const { impl } = fakeFetch({ 'sgs.13522/': bcb(m.map((p, i) => [p, i === 23 ? '9.99' : (4 + i * 0.01).toFixed(2)])) });
    await refreshAll({ fetchImpl: impl });
    const i = await indicator('inflacao');
    expect(i.badge).toBe('divergencia');
    expect(i.notes.join(' ')).toMatch(/Banco Central difere da origem em 1 de 12 períodos/);
  });

  it('código que não confere (nome inesperado) não mostra número trocado', async () => {
    const { impl } = fakeFetch({ 'agregados/6381': ibge('Rendimento médio real', months(12).map((p) => [p, '3000'])) });
    await refreshAll({ fetchImpl: impl });
    const i = await indicator('emprego');
    expect(i.badge).toBe('sem_dados');
    expect(i.latest).toBeNull();
    expect(i.notes[0]).toMatch(/código não confere/);
  });

  it('fonte independente na direção oposta vira "em divergência"', async () => {
    const m = months(24);
    const { impl } = fakeFetch({ 'sgs.24363/': bcb(m.map((p, i) => [p, 200 - i])) }); // atividade caindo, PIB subindo
    await refreshAll({ fetchImpl: impl });
    const i = await indicator('economia');
    expect(i).toMatchObject({ badge: 'divergencia', checks: { independente: 'diverge' } });
  });

  it('revisão do produtor fica registrada; falha da fonte mantém o último dado', async () => {
    await refreshAll({ fetchImpl: fakeFetch().impl });
    const m = months(24);
    const revised = fakeFetch({
      'agregados/1737': ibge('IPCA - Variação acumulada em 12 meses', m.map((p, i) => [p, i === 23 ? '4.50' : (4 + i * 0.01).toFixed(2)])),
      'sgs.13522/': bcb(m.map((p, i) => [p, i === 23 ? '4.50' : (4 + i * 0.01).toFixed(2)])),
    });
    await refreshAll({ fetchImpl: revised.impl });
    let i = await indicator('inflacao');
    expect(i.revised).toBe(true);
    expect(i.latest).toMatchObject({ value: 4.5, previous_value: 4.23 });

    await refreshAll({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    i = await indicator('inflacao');
    expect(i.sources[0].last_attempt.error).toMatch(/não foi possível conectar à fonte/);
    await refreshAll({ fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'fora do ar' }) });
    i = await indicator('inflacao');
    expect(i.latest.value).toBe(4.5); // o último dado bom continua
    expect(i.sources[0].last_attempt).toMatchObject({ ok: false, error: 'a fonte respondeu 503' });
  });

  it('dado velho fica "desatualizado"', async () => {
    const old = months(24, 10); // termina há 10 meses
    const { impl } = fakeFetch({
      'agregados/1737': ibge('IPCA - Variação acumulada em 12 meses', old.map((p) => [p, '4.00'])),
      'sgs.13522/': bcb(old.map((p) => [p, '4.00'])),
    });
    await refreshAll({ fetchImpl: impl });
    const i = await indicator('inflacao');
    expect(i.badge).toBe('desatualizado');
    expect(i.notes.join(' ')).toMatch(/meses atrás/);
  });
});

describe('registro conferido à mão', () => {
  const now = new Date(`${REGISTRO.checked_at}T12:00:00Z`);

  it('cada número do registro vem com a publicação da origem e onde mais foi conferido', () => {
    for (const [key, e] of Object.entries(REGISTRO.sources)) {
      expect(e.url, key).toMatch(/^https:\/\//);
      expect(e.published, key).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(e.observations.length, key).toBeGreaterThan(0);
      expect(e.evidence.length, key).toBeGreaterThan(0);
      for (const o of e.observations) expect(o.period, key).toMatch(/^\d{6}$|^\d{4}T[1-4]$/);
    }
  });

  it('carrega uma vez só (com hash) e monta os selos sem inventar o que falta', async () => {
    const first = await loadRegistro();
    expect(first.every((r) => r.ok && !r.unchanged)).toBe(true);
    expect((await loadRegistro()).every((r) => r.unchanged)).toBe(true);
    const { rows } = await query("SELECT count(*)::int AS n FROM official_raw WHERE source_key = 'ibge_ipca_12m'");
    expect(rows[0].n).toBe(1);

    const { indicators, mode, checked_at } = await allIndicators({ now });
    expect({ mode, checked_at }).toEqual({ mode: 'registro', checked_at: REGISTRO.checked_at });
    const by = Object.fromEntries(indicators.map((i) => [i.id, i]));
    expect(by.inflacao.latest.value).toBe(REGISTRO.sources.ibge_ipca_12m.observations.at(-1).value);
    // A cópia do Banco Central não foi conferida: não é divergência, só não há comparação.
    expect(by.inflacao).toMatchObject({ badge: 'fonte_unica', checks: { consistencia: 'sem_republicacao' } });
    expect(by.inflacao.notes.join(' ')).toMatch(/cópia do Banco Central ainda não foi conferida/);
    // Cesta: a origem está no registro, a fonte independente não: conferência parcial.
    expect(by.comida).toMatchObject({ badge: 'parcial', checks: { origem: 'ok', independente: 'sem_dados' } });
    expect(by.economia).toMatchObject({ badge: 'confirmado', checks: { independente: 'concorda' } });
    expect(by.juros.badge).toBe('fonte_unica');
    const origin = by.emprego.sources.find((s) => s.role === 'origem');
    expect(origin.registro).toMatchObject({ checked_at: REGISTRO.checked_at, published: expect.any(String), evidence: expect.any(Array) });
    expect(origin.original.url).toBe(REGISTRO.sources.ibge_desocupacao.url);
  });

  it('sem atualização, o registro envelhece e o selo avisa', async () => {
    await loadRegistro();
    const later = new Date(now);
    later.setMonth(later.getMonth() + 8);
    expect((await indicator('inflacao', { now: later })).badge).toBe('desatualizado');
  });

  it('uma correção no registro fica marcada como revisão', async () => {
    await loadRegistro();
    const e = REGISTRO.sources.ibge_ipca_12m;
    const fixed = { ...REGISTRO, sources: { ibge_ipca_12m: { ...e, observations: [...e.observations.slice(0, -1), { ...e.observations.at(-1), value: 4.6 }] } } };
    await loadRegistro(fixed);
    const i = await indicator('inflacao', { now });
    expect(i.latest).toMatchObject({ value: 4.6, previous_value: e.observations.at(-1).value });
  });
});

describe('rotas', () => {
  it('a aba é pública; forçar atualização é só da moderação', async () => {
    expect((await api().get('/api/dados')).status).toBe(200);
    expect((await api().get('/api/dados/inflacao')).body.data.badge).toBe('sem_dados');
    expect((await api().get('/api/dados/inexistente')).status).toBe(400);
    const alice = await signup('alice');
    expect((await api().post('/api/moderacao/dados/atualizar').set(alice.auth)).status).toBe(403);
    // (A coleta real não roda nos testes: eles não dependem de internet.)
  });
});
