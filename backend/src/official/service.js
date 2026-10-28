import { createHash } from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { notFound } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { readSource } from './adapters.js';
import { byId, CATALOG } from './catalog.js';

// Coleta e verificação tripla da aba "Brasil em dados" (docs/13 §3).
//   A. origem        — a fonte produtora respondeu e o código confere;
//   B. independente  — outra instituição/método concorda (valor dentro da tolerância, ou mesma direção);
//   C. consistência  — quem republica bate com a origem no mesmo período, e o dado não está velho.

const sha256 = (s) => createHash('sha256').update(s ?? '').digest('hex');

/** Busca todas as fontes, uma de cada vez (sem pressa: são poucas e há limites de uso). */
export async function refreshAll({ fetchImpl, now = new Date(), only } = {}) {
  const report = [];
  for (const ind of CATALOG) {
    for (const src of ind.sources) {
      if (only && !only.includes(src.key)) continue;
      report.push(await refreshSource(src, { fetchImpl, now, frequency: ind.frequency }));
    }
  }
  return report;
}

async function refreshSource(src, opts) {
  const rawId = nextId();
  try {
    const r = await readSource(src, opts);
    await withTransaction(async (c) => {
      await c.query('INSERT INTO official_raw (id, source_key, url, ok, sha256, body) VALUES ($1, $2, $3, true, $4, $5)', [
        rawId,
        src.key,
        r.url,
        sha256(r.body),
        r.body,
      ]);
      for (const o of r.observations) {
        // Revisão: se o período já existia com outro valor, guarda o anterior.
        await c.query(
          `INSERT INTO official_observations (source_key, period, value, raw_id) VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_key, period) DO UPDATE SET
             previous_value = CASE WHEN official_observations.value <> EXCLUDED.value THEN official_observations.value ELSE official_observations.previous_value END,
             revised_at     = CASE WHEN official_observations.value <> EXCLUDED.value THEN now() ELSE official_observations.revised_at END,
             value = EXCLUDED.value, raw_id = EXCLUDED.raw_id, updated_at = now()`,
          [src.key, o.period, o.value, rawId],
        );
      }
    });
    return { source: src.key, ok: true, observations: r.observations.length };
  } catch (err) {
    await query('INSERT INTO official_raw (id, source_key, url, ok, sha256, body, error) VALUES ($1, $2, $3, false, $4, $5, $6)', [
      rawId,
      src.key,
      err.url ?? null,
      err.body ? sha256(err.body) : null,
      err.body ? String(err.body).slice(0, 2000) : null,
      err.message,
    ]);
    return { source: src.key, ok: false, error: err.message, pending: Boolean(err.pending) };
  }
}

async function sourceState(src) {
  const { rows: obs } = await query(
    `SELECT o.period, o.value::float8 AS value, o.previous_value::float8 AS previous_value, o.revised_at,
            r.url, r.sha256, r.fetched_at
       FROM official_observations o JOIN official_raw r ON r.id = o.raw_id
      WHERE o.source_key = $1 ORDER BY o.period`,
    [src.key],
  );
  const { rows: last } = await query('SELECT ok, error, fetched_at FROM official_raw WHERE source_key = $1 ORDER BY id DESC LIMIT 1', [src.key]);
  return { obs, lastAttempt: last[0] ?? null };
}

const sameSign = (a, b, deadZone = 0.5) => (Math.abs(a) <= deadZone && Math.abs(b) <= deadZone) || Math.sign(a) === Math.sign(b);

/** Tendência de uma série: se for taxa (%), o último valor; se for nível (R$), a variação em 12 períodos. */
function trendOf(obs, unit) {
  const last = obs.at(-1);
  if (!last) return null;
  if (unit === '%' || unit?.startsWith('%')) return last.value;
  const back = obs.at(-13);
  return back ? ((last.value / back.value - 1) * 100) : null;
}

/** Quantos meses sem dado novo tornam o indicador "desatualizado". */
const STALE_MONTHS = { mensal: 3, 'mensal (trimestre móvel)': 3, trimestral: 7, 'a cada reunião do Copom': 3 };

function monthsSince(period, now) {
  const y = Number(period.slice(0, 4));
  const m = period.includes('T') ? Number(period.slice(5)) * 3 : Number(period.slice(4, 6));
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

/** Monta o cartão de um indicador: valor, histórico, fontes, conferências e selo. */
export async function indicator(id, { now = new Date() } = {}) {
  const ind = byId(id);
  if (!ind) throw notFound('Indicador não encontrado');
  const states = await Promise.all(ind.sources.map(sourceState));
  const sources = ind.sources.map((s, i) => {
    const { obs, lastAttempt } = states[i];
    const latest = obs.at(-1) ?? null;
    return {
      key: s.key,
      role: s.role,
      institution: s.institution,
      kind: s.kind,
      label: s.label ?? null,
      unit: s.unit ?? ind.unit,
      page: s.page,
      latest: latest && { period: latest.period, value: latest.value, previous_value: latest.previous_value, revised_at: latest.revised_at },
      original: latest && { url: latest.url, sha256: latest.sha256, fetched_at: latest.fetched_at },
      last_attempt: lastAttempt && { ok: lastAttempt.ok, error: lastAttempt.error, at: lastAttempt.fetched_at },
      _obs: obs,
    };
  });

  const origin = sources.find((s) => s.role === 'origem');
  const checks = { origem: null, independente: null, consistencia: null };
  const notes = [];

  // A. Origem
  checks.origem = origin?.latest ? 'ok' : 'sem_dados';
  if (!origin?.latest) notes.push(origin?.last_attempt?.error ? `Origem (${origin.institution}): ${origin.last_attempt.error}.` : `Ainda não há dado da origem (${origin?.institution}).`);

  // C. Consistência: republicações batem no mesmo período; dado não pode estar velho.
  const reps = sources.filter((s) => s.role === 'republicacao');
  if (origin?.latest) {
    const issues = [];
    for (const r of reps) {
      const mine = new Map(r._obs.map((o) => [o.period, o.value]));
      const common = origin._obs.filter((o) => mine.has(o.period)).slice(-12);
      if (!common.length) {
        issues.push(`${r.institution} ainda sem período em comum para comparar`);
        continue;
      }
      const bad = common.filter((o) => Math.abs(o.value - mine.get(o.period)) > (ind.tolerance ?? 0.01));
      if (bad.length) issues.push(`${r.institution} difere da origem em ${bad.length} de ${common.length} períodos (ex.: ${bad[0].period}: ${bad[0].value} × ${mine.get(bad[0].period)})`);
    }
    const age = monthsSince(origin.latest.period, now);
    const stale = age > (STALE_MONTHS[ind.frequency] ?? 6);
    if (stale) issues.push(`o dado mais recente é de ${age} meses atrás`);
    checks.consistencia = issues.length ? 'falhou' : reps.length ? 'ok' : 'sem_republicacao';
    if (issues.length) notes.push(`Consistência: ${issues.join('; ')}.`);
    checks.stale = stale;
  }

  // B. Independente: outra instituição/método concorda.
  const indeps = sources.filter((s) => s.role === 'independente');
  if (!indeps.length) {
    checks.independente = 'nao_existe';
    if (ind.single) notes.push(ind.single);
  } else if (origin?.latest) {
    const results = indeps.map((s) => {
      if (!s.latest) return 'sem_dados';
      const a = trendOf(origin._obs, ind.unit);
      const b = trendOf(s._obs, s.unit);
      if (a === null || b === null) return 'sem_dados';
      return sameSign(a, b) ? 'concorda' : 'diverge';
    });
    checks.independente = results.includes('diverge') ? 'diverge' : results.includes('concorda') ? 'concorda' : 'sem_dados';
    if (checks.independente === 'diverge') notes.push('A fonte independente aponta outra direção: veja os dois valores e os métodos.');
  } else {
    checks.independente = 'sem_dados';
  }

  // Selo (docs/13 §3.3)
  let badge;
  if (checks.origem !== 'ok') badge = 'sem_dados';
  else if (checks.independente === 'diverge' || checks.consistencia === 'falhou') badge = checks.stale && checks.independente !== 'diverge' ? 'desatualizado' : 'divergencia';
  else if (checks.independente === 'concorda' && checks.consistencia !== 'falhou') badge = 'confirmado';
  else if (checks.independente === 'nao_existe') badge = 'fonte_unica';
  else badge = 'parcial';

  const history = (origin?._obs ?? []).slice(-24).map(({ period, value }) => ({ period, value }));
  const prev = history.at(-2) ?? null;
  return {
    id: ind.id,
    section: ind.section,
    title: ind.title,
    unit: ind.unit,
    decimals: ind.decimals,
    frequency: ind.frequency,
    why: ind.why,
    latest: origin?.latest ?? null,
    previous: prev,
    revised: Boolean(origin?.latest?.revised_at),
    history,
    badge,
    checks,
    notes,
    sources: sources.map(({ _obs, ...s }) => ({ ...s, history: _obs.slice(-24).map(({ period, value }) => ({ period, value })) })),
  };
}

export async function allIndicators(opts) {
  const list = await Promise.all(CATALOG.map((i) => indicator(i.id, opts)));
  const { rows } = await query('SELECT max(fetched_at) AS at FROM official_raw WHERE ok');
  return { indicators: list, updated_at: rows[0].at };
}

// ---------- Atualização periódica ----------
let timer = null;
export function startRefreshLoop({ minutes, log = console.log } = {}) {
  if (!minutes || timer) return;
  const run = () =>
    refreshAll()
      .then((r) => log(`[dados] ${r.filter((x) => x.ok).length}/${r.length} fontes atualizadas`))
      .catch((e) => log('[dados] falha ao atualizar:', e.message));
  setTimeout(run, 5_000);
  timer = setInterval(run, minutes * 60_000);
  timer.unref?.();
}
