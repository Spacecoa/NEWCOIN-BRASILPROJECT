import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Sparkline from '../components/Sparkline.jsx';
import { api } from '../lib/api.js';
import { BADGES, changeLabel, formatValue, periodLabel, ROLE_LABEL } from '../lib/officialData.js';
import { relativeTime } from '../lib/time.js';

const TONE = {
  ok: 'bg-brand-50 text-brand-700 dark:bg-zinc-900 dark:text-brand-500',
  info: 'bg-sky-50 text-sky-800 dark:bg-zinc-900 dark:text-sky-300',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  muted: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400',
};

const CHECK_TEXT = {
  origem: { ok: 'A origem respondeu e o código confere', sem_dados: 'A origem ainda não respondeu' },
  consistencia: { ok: 'A cópia de outra instituição bate com a origem', falhou: 'A cópia ou a data não conferem', sem_republicacao: 'Não há quem republique para conferir a cópia' },
  independente: { concorda: 'Uma fonte independente concorda', diverge: 'Uma fonte independente discorda', nao_existe: 'Não existe fonte independente para este dado', sem_dados: 'A fonte independente ainda não respondeu' },
};

function Badge({ badge }) {
  const b = BADGES[badge];
  return <span title={b.help} className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-extrabold ${TONE[b.tone]}`}>{b.label}</span>;
}

function SourceRow({ s, decimals }) {
  return (
    <li className="space-y-0.5 py-2">
      <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">{ROLE_LABEL[s.role]}</p>
      <p>
        <b>{s.institution}</b>
        {s.label && <span className="text-zinc-500"> · {s.label}</span>}
      </p>
      {s.latest ? (
        <p className="text-zinc-600 dark:text-zinc-300">
          {formatValue(s.latest.value, s.unit, decimals)} em {periodLabel(s.latest.period)}
          {s.latest.revised_at && <span className="text-amber-700 dark:text-amber-300"> · revisado (antes: {formatValue(s.latest.previous_value, s.unit, decimals)})</span>}
        </p>
      ) : (
        <p className="text-zinc-500">{s.last_attempt?.error ? `Sem dado: ${s.last_attempt.error}` : 'Ainda não lida'}</p>
      )}
      {s.original && (
        <p className="break-all text-xs text-zinc-400">
          Lido {relativeTime(s.original.fetched_at)} · original guardado (sha256 {s.original.sha256.slice(0, 12)}…)
        </p>
      )}
      {s.last_attempt && !s.last_attempt.ok && s.latest && <p className="text-xs text-amber-700 dark:text-amber-300">A última tentativa falhou: {s.last_attempt.error}. Mostrando o último dado bom.</p>}
      <a href={s.page} target="_blank" rel="noreferrer" className="inline-block min-h-9 py-2 text-sm font-extrabold text-brand-600">
        Ver na fonte ↗
      </a>
    </li>
  );
}

function IndicatorCard({ ind }) {
  const [open, setOpen] = useState(false);
  const change = changeLabel(ind.latest, ind.previous, ind.unit, ind.decimals);
  const others = ind.sources.filter((s) => s.role !== 'origem' && s.latest);
  return (
    <article className="rounded-3xl bg-zinc-50 p-5 dark:bg-zinc-900" aria-labelledby={`t-${ind.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`t-${ind.id}`} className="font-extrabold">{ind.title}</h3>
        <Badge badge={ind.badge} />
      </div>
      {ind.latest ? (
        <div className="mt-2">
          <p className="text-4xl font-extrabold tracking-tight tabular-nums">{formatValue(ind.latest.value, ind.unit, ind.decimals)}</p>
          <p className="text-sm text-zinc-500">
            {periodLabel(ind.latest.period)}
            {change && ` · ${change}`}
            {ind.revised && ' · número revisado pela fonte'}
          </p>
          <div className="mt-2">
            <Sparkline points={ind.history} label={`Histórico de ${ind.title}: ${ind.history.length} períodos`} />
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          <p className="text-2xl font-extrabold text-zinc-400">—</p>
          {others.map((s) => (
            <p key={s.key} className="text-sm">
              Enquanto isso: <b>{s.label ?? s.institution}</b> = {formatValue(s.latest.value, s.unit, ind.decimals)} ({periodLabel(s.latest.period)})
            </p>
          ))}
        </div>
      )}
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{ind.why}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 min-h-11 text-sm font-extrabold text-brand-600">
        {open ? 'Fechar' : 'De onde vem este número?'}
      </button>
      {open && (
        <div className="mt-1 space-y-3 text-sm">
          <ul className="space-y-1">
            {Object.entries(CHECK_TEXT).map(([k, text]) => {
              const v = ind.checks[k];
              const good = v === 'ok' || v === 'concorda';
              return (
                <li key={k} className="flex gap-2">
                  <span aria-hidden="true">{good ? '✓' : v === 'nao_existe' || v === 'sem_republicacao' ? '•' : '!'}</span>
                  <span>{text[v] ?? '—'}</span>
                </li>
              );
            })}
          </ul>
          {ind.notes.length > 0 && (
            <div className="rounded-2xl bg-white p-3 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
              {ind.notes.map((n) => <p key={n}>{n}</p>)}
            </div>
          )}
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {ind.sources.map((s) => <SourceRow key={s.key} s={s} decimals={ind.decimals} />)}
          </ul>
          <p className="text-xs text-zinc-500">Frequência: {ind.frequency}.</p>
        </div>
      )}
    </article>
  );
}

/** Aba "Brasil em dados": números que importam no dia a dia, de fontes oficiais e independentes. */
export default function Brasil() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/dados').then((r) => setData(r.data)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      await api('/api/moderacao/dados/atualizar', { method: 'POST' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const sections = data ? [...new Set(data.indicators.map((i) => i.section))] : [];
  const nothing = data && data.indicators.every((i) => !i.latest);

  return (
    <>
      <PageHeader title="Brasil em dados" subtitle={data?.updated_at ? `Atualizado ${relativeTime(data.updated_at)}` : 'Fontes oficiais e independentes'} />
      <div className="space-y-6 px-4 pb-10">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Números sobre preços, comida, trabalho e economia, lidos direto de quem os produz e conferidos três vezes. Aqui não há opinião nem ranking: só o dado, a
          data e de onde ele vem.
        </p>
        <details className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
          <summary className="cursor-pointer font-extrabold">Como conferimos</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
            <li><b>Origem:</b> lemos o dado de quem o produz (IBGE, Banco Central, DIEESE) e guardamos a resposta original.</li>
            <li><b>Fonte independente:</b> outra instituição ou outro método mede a mesma coisa. Se discordar, mostramos as duas.</li>
            <li><b>Consistência:</b> quem republica precisa bater com a origem, e o dado não pode estar velho.</li>
          </ol>
          <ul className="mt-3 space-y-1">
            {Object.entries(BADGES).map(([k, b]) => (
              <li key={k}><Badge badge={k} /> <span className="text-zinc-500">{b.help}</span></li>
            ))}
          </ul>
        </details>
        {error && <p role="alert" className="text-rose-600">{error}</p>}
        {!data && !error && <p className="text-zinc-400">Carregando…</p>}
        {nothing && (
          <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Ainda não há dados: o servidor não conseguiu ler as fontes oficiais. Ele precisa de acesso a servicodados.ibge.gov.br e api.bcb.gov.br. Veja o motivo em
            cada cartão, em &quot;De onde vem este número?&quot;.
          </p>
        )}
        {user?.is_moderator && (
          <button type="button" onClick={refresh} disabled={busy} className="min-h-11 rounded-full bg-zinc-100 px-5 text-sm font-extrabold disabled:opacity-50 dark:bg-zinc-900">
            {busy ? 'Buscando nas fontes…' : 'Atualizar agora'}
          </button>
        )}
        {sections.map((sec) => (
          <section key={sec} aria-label={sec} className="space-y-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-zinc-500">{sec}</h2>
            {data.indicators.filter((i) => i.section === sec).map((ind) => <IndicatorCard key={ind.id} ind={ind} />)}
          </section>
        ))}
        {data && (
          <p className="text-xs text-zinc-400">
            Os dados são públicos e podem ser reutilizados citando a fonte (Política de Dados Abertos, Decreto 8.777/2016). O Ágora mostra o número e a origem; a
            interpretação é de cada pessoa.
          </p>
        )}
      </div>
    </>
  );
}
