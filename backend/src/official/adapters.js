// Leitores das fontes. Cada um devolve { url, observations: [{ period, value }], name? }
// com períodos normalizados: 'AAAAMM' (mensal), 'AAAATn' (trimestral) ou 'AAAAMMDD' (diário).
//
// Formatos segundo a documentação pública:
//  - IBGE, API de agregados v3: [{ variavel, unidade, resultados: [{ series: [{ serie: { "202409": "0.44" } }] }] }]
//  - Banco Central, SGS:        [{ data: "01/09/2024", valor: "0.44" }]  (janela máxima de 10 anos)

const UA = 'Agora-prototipo-de-pesquisa (+https://github.com/Spacecoa/NEWCOIN-BRASILPROJECT)';

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null; // "..." e "-" (sem dado) viram null
};

/** '202403' mensal · '202401' trimestral na PNAD/Contas (IBGE usa AAAA0T para trimestres). */
function ibgePeriod(code, frequency) {
  if (frequency === 'trimestral' && /^\d{6}$/.test(code)) return `${code.slice(0, 4)}T${Number(code.slice(4))}`;
  return code;
}

export function parseIbge(json, { frequency } = {}) {
  const v = Array.isArray(json) ? json[0] : null;
  if (!v?.resultados?.[0]?.series?.[0]?.serie) throw new Error('resposta do IBGE em formato inesperado');
  const serie = v.resultados[0].series[0].serie;
  const observations = Object.entries(serie)
    .map(([period, value]) => ({ period: ibgePeriod(period, frequency), value: num(value) }))
    .filter((o) => o.value !== null)
    .sort((a, b) => a.period.localeCompare(b.period));
  return { name: v.variavel ?? '', unit: v.unidade ?? '', observations };
}

export function parseBcb(json) {
  if (!Array.isArray(json)) throw new Error('resposta do Banco Central em formato inesperado');
  const observations = json
    .map((r) => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.data ?? '');
      return m ? { period: `${m[3]}${m[2]}`, day: `${m[3]}${m[2]}${m[1]}`, value: num(r.valor) } : null;
    })
    .filter((o) => o && o.value !== null);
  // Séries diárias (Selic): fica o último valor de cada mês.
  const byMonth = new Map();
  for (const o of observations) byMonth.set(o.period, o);
  return { observations: [...byMonth.values()].map(({ period, value }) => ({ period, value })).sort((a, b) => a.period.localeCompare(b.period)) };
}

/** Acumula 12 variações mensais (%) em uma variação de 12 meses (%). */
export function accumulate12(obs) {
  const out = [];
  for (let i = 11; i < obs.length; i++) {
    const win = obs.slice(i - 11, i + 1);
    const acc = (win.reduce((f, o) => f * (1 + o.value / 100), 1) - 1) * 100;
    out.push({ period: obs[i].period, value: Math.round(acc * 100) / 100 });
  }
  return out;
}

/** Variação contra o mesmo mês do ano anterior (%), para índices. */
export function yearOverYear(obs) {
  const map = new Map(obs.map((o) => [o.period, o.value]));
  return obs
    .map((o) => {
      const prev = map.get(`${Number(o.period.slice(0, 4)) - 1}${o.period.slice(4)}`);
      return prev ? { period: o.period, value: Math.round(((o.value / prev - 1) * 100) * 100) / 100 } : null;
    })
    .filter(Boolean);
}

const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export function urlFor(source, now = new Date()) {
  const p = source.params;
  if (source.adapter === 'ibge') {
    const cls = p.classification ? `&classificacao=${p.classification}` : '';
    return `https://servicodados.ibge.gov.br/api/v3/agregados/${p.table}/periodos/-24/variaveis/${p.variable}?localidades=${p.locality}${cls}`;
  }
  if (source.adapter === 'bcb') {
    // Filtro de datas é obrigatório e a janela máxima é de 10 anos: pedimos ~3 anos.
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 3);
    return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${p.series}/dados?formato=json&dataInicial=${ddmmyyyy(start)}&dataFinal=${ddmmyyyy(now)}`;
  }
  return null;
}

/**
 * Busca e interpreta uma fonte. `fetchImpl` é injetável (testes). Nunca inventa valor:
 * se a fonte não responde ou o formato não confere, devolve erro.
 */
export async function readSource(source, { fetchImpl = fetch, now = new Date(), frequency } = {}) {
  if (source.adapter === 'dieese') {
    // O DIEESE publica a cesta em páginas e PDFs, sem API documentada. O leitor depende de
    // validar o formato com acesso à rede (docs/13 §12); até lá a fonte aparece como não conectada.
    throw Object.assign(new Error('fonte ainda não conectada (o DIEESE não tem API pública; leitor pendente)'), { pending: true });
  }
  const url = urlFor(source, now);
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw Object.assign(new Error(timeout ? 'a fonte demorou demais para responder' : 'não foi possível conectar à fonte (sem internet, rede bloqueada ou fonte fora do ar)'), { url });
  }
  // Teto de tamanho: uma fonte respondendo algo enorme não enche memória nem banco (docs/14, D-1).
  const MAX_BODY = 2 * 1024 * 1024;
  if (Number(res.headers?.get?.('content-length') ?? 0) > MAX_BODY) throw Object.assign(new Error('a resposta da fonte é grande demais'), { url });
  const body = await res.text();
  if (body.length > MAX_BODY) throw Object.assign(new Error('a resposta da fonte é grande demais'), { url });
  if (!res.ok) throw Object.assign(new Error(`a fonte respondeu ${res.status}`), { url, body });
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw Object.assign(new Error('a fonte não devolveu JSON'), { url, body });
  }
  let parsed = source.adapter === 'ibge' ? parseIbge(json, { frequency }) : parseBcb(json);
  if (source.params.accumulate12) parsed = { ...parsed, observations: accumulate12(parsed.observations) };
  if (source.params.yoy) parsed = { ...parsed, observations: yearOverYear(parsed.observations) };
  if (source.expect && !String(parsed.name ?? '').toLowerCase().includes(source.expect.toLowerCase())) {
    throw Object.assign(new Error(`o código não confere: a fonte devolveu "${parsed.name}"`), { url, body, mismatch: true });
  }
  return { url, body, ...parsed };
}
