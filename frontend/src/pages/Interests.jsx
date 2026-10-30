import { useEffect, useState } from 'react';
import LoadError from '../components/LoadError.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { learnedView, loadState, resetLearning as resetLocal, saveSettings as saveLocal } from '../lib/deviceAlgo.js';
import { syncDeviceAlgorithm } from '../lib/rankingMode.js';

const ALGO_KEYS = ['muted_topics', 'keywords', 'weights', 'topics', 'session_limit', 'diversity', 'half_life_hours', 'hide_metrics'];
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

const pct = (v) => Math.round(v * 100);

function Section({ title, hint, children }) {
  return (
    <section className="px-4 py-4">
      <h2 className="text-base font-extrabold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

function Slider({ id, label, hint, value, onChange, disabled }) {
  return (
    <div className={`py-2 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-semibold">{label}</label>
        <span className="text-sm tabular-nums text-zinc-500">{pct(value)}%</span>
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step="5"
        value={pct(value)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="mt-1 h-11 w-full accent-brand-600"
      />
    </div>
  );
}

function LearnedBar({ label, value }) {
  const positive = value >= 0;
  return (
    <li className="py-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-500">{positive ? '+' : ''}{pct(value)}</span>
      </div>
      <div className="mt-1 grid h-1.5 grid-cols-2 gap-px overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
        <div className="flex justify-end">{!positive && <div className="h-full rounded-full bg-zinc-400" style={{ width: `${pct(-value)}%` }} />}</div>
        <div>{positive && <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct(value)}%` }} />}</div>
      </div>
    </li>
  );
}

/** Painel de controle do algoritmo aberto: tudo que o ranking usa está aqui, editável. */
export default function Interests() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const { user } = useAuth();

  // O algoritmo fica só neste aparelho: preferências e aprendizado vêm do navegador.
  // O servidor guarda apenas as opções que não são do algoritmo (missões e contagem de tempo).
  const load = () =>
    syncDeviceAlgorithm(user.id)
      .then(() => api('/api/feed/preferencias'))
      .then((r) => {
        const local = loadState(user.id).settings;
        setData({ ...r, learned: learnedView(user.id) });
        setDraft({ ...local, missions_enabled: r.settings.missions_enabled, count_time: r.settings.count_time });
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  if (error && !data) return <LoadError message={error} onRetry={() => { setError(null); load(); }} />;
  if (!draft) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;

  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
  };
  const totalWeight = Object.values(draft.weights).reduce((a, b) => a + b, 0) || 1;
  const muted = new Set(draft.muted_topics);

  async function save() {
    setError(null);
    try {
      const { missions_enabled, count_time } = draft;
      const saved = saveLocal(user.id, pick(draft, ALGO_KEYS));
      await api('/api/feed/preferencias', { method: 'PUT', body: { missions_enabled, count_time } });
      setDraft((d) => ({ ...d, ...saved }));
      setStatus('Preferências salvas neste aparelho. O servidor não recebeu nenhuma delas.');
    } catch (e) {
      setError(e.details?.map((d) => `${d.path}: ${d.message}`).join(' · ') || e.message);
    }
  }

  async function resetLearning() {
    if (!confirm('Apagar tudo o que o algoritmo aprendeu com suas interações neste aparelho?')) return;
    resetLocal(user.id);
    await load();
    setStatus('Aprendizado apagado. Ficam só as preferências que você declarou.');
  }

  function addKeyword(e) {
    e.preventDefault();
    const k = keyword.trim().toLowerCase();
    if (k.length >= 2 && !draft.keywords.includes(k) && draft.keywords.length < 20) set({ keywords: [...draft.keywords, k] });
    setKeyword('');
  }

  return (
    <>
      <PageHeader back title="Meu algoritmo" subtitle="Aberto, explicável e sob seu controle" />

      <Section
        title="Onde fica o seu algoritmo"
        hint="Só neste aparelho. O navegador guarda suas preferências e o que o algoritmo aprende, e faz a conta do feed aqui."
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>Sempre que você volta ao app, o seu algoritmo é carregado deste aparelho.</li>
          <li>A instância não sabe do que você gosta: ela só entrega os posts candidatos, iguais para todo mundo.</li>
          <li>Sair da conta não apaga o algoritmo deste aparelho. Limpar os dados do site apaga.</li>
          <li>Em outro aparelho, o algoritmo começa do zero e aprende com você lá.</li>
        </ul>
      </Section>

      <Section
        title="Como o feed Para você é montado"
        hint="Cada post recebe uma nota de 0 a 100. Estes pesos dizem quanto cada fator conta. Popularidade começa em zero: o feed não premia o que viraliza."
      >
        {data.factors.map((f) => (
          <Slider
            key={f.id}
            id={`w-${f.id}`}
            label={`${f.descricao} · ${Math.round((draft.weights[f.id] / totalWeight) * 100)}% da nota`}
            value={draft.weights[f.id]}
            onChange={(v) => set({ weights: { ...draft.weights, [f.id]: v } })}
          />
        ))}
      </Section>

      <Section title="Seus tópicos" hint="Quanto cada assunto importa para você. Silenciar remove o tópico do feed Para você.">
        <ul>
          {data.topics.map((t) => (
            <li key={t.id} className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <Slider
                  id={`t-${t.id}`}
                  label={t.label}
                  value={draft.topics[t.id] ?? 0}
                  disabled={muted.has(t.id)}
                  onChange={(v) => set({ topics: { ...draft.topics, [t.id]: v } })}
                />
              </div>
              <button
                type="button"
                aria-pressed={muted.has(t.id)}
                onClick={() =>
                  set({ muted_topics: muted.has(t.id) ? draft.muted_topics.filter((x) => x !== t.id) : [...draft.muted_topics, t.id] })
                }
                className={`mb-3 min-h-9 rounded-full px-3 text-xs font-extrabold ${muted.has(t.id) ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-900'}`}
              >
                {muted.has(t.id) ? 'Silenciado' : 'Silenciar'}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Suas linhas de interesse" hint="Palavras livres. Um post que contenha qualquer uma delas ganha interesse máximo.">
        <form onSubmit={addKeyword} className="flex gap-2">
          <label htmlFor="kw" className="sr-only">Nova palavra-chave</label>
          <input
            id="kw"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            maxLength={40}
            placeholder="ex.: webassembly, ciclovia"
            className="min-h-11 min-w-0 flex-1 rounded-full bg-zinc-50 px-4 outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
          />
          <button className="min-h-11 rounded-full bg-zinc-100 px-4 font-extrabold dark:bg-zinc-900">Adicionar</button>
        </form>
        <ul className="mt-3 flex flex-wrap gap-2">
          {draft.keywords.map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => set({ keywords: draft.keywords.filter((x) => x !== k) })}
                aria-label={`Remover ${k}`}
                className="min-h-9 rounded-full bg-brand-50 px-3 text-sm font-semibold text-brand-700 dark:bg-brand-600/15 dark:text-brand-100"
              >
                {k} ×
              </button>
            </li>
          ))}
          {!draft.keywords.length && <li className="text-sm text-zinc-400">Nenhuma ainda.</li>}
        </ul>
      </Section>

      <Section title="Limites saudáveis" hint="O feed Para você tem fim. Você decide onde.">
        <div className="py-2">
          <div className="flex justify-between">
            <label htmlFor="limit" className="font-semibold">Posts por sessão</label>
            <span className="text-sm tabular-nums text-zinc-500">{draft.session_limit}</span>
          </div>
          <input id="limit" type="range" min="10" max="100" step="5" value={draft.session_limit} onChange={(e) => set({ session_limit: Number(e.target.value) })} className="h-11 w-full accent-brand-600" />
        </div>
        <Slider id="div" label="Variedade" hint="Evita vários posts seguidos do mesmo autor ou assunto." value={draft.diversity} onChange={(v) => set({ diversity: v })} />
        <div className="py-2">
          <label htmlFor="hl" className="font-semibold">Quanto tempo um post continua “novo”</label>
          <select
            id="hl"
            value={draft.half_life_hours}
            onChange={(e) => set({ half_life_hours: Number(e.target.value) })}
            className="mt-1 min-h-11 w-full rounded-2xl bg-zinc-50 px-4 dark:bg-zinc-900"
          >
            <option value={6}>Pouco: metade do valor a cada 6 h</option>
            <option value={24}>Normal: metade a cada 24 h</option>
            <option value={72}>Bastante: metade a cada 3 dias</option>
          </select>
        </div>
        <label className="flex min-h-11 items-center justify-between gap-3 py-2">
          <span>
            <span className="block font-semibold">Esconder contadores</span>
            <span className="block text-xs text-zinc-500">Sem números de curtidas e reposts no feed Para você.</span>
          </span>
          <input type="checkbox" checked={draft.hide_metrics} onChange={(e) => set({ hide_metrics: e.target.checked })} className="h-5 w-5 accent-brand-600" />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 py-2">
          <span>
            <span className="block font-semibold">Missões diárias</span>
            <span className="block text-xs text-zinc-500">Até 4 por dia, com recompensa em token interno. Sem sequências nem ranking.</span>
          </span>
          <input type="checkbox" checked={draft.missions_enabled} onChange={(e) => set({ missions_enabled: e.target.checked })} className="h-5 w-5 accent-brand-600" />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 py-2">
          <span>
            <span className="block font-semibold">Contar meu tempo no app</span>
            <span className="block text-xs text-zinc-500">Só minutos ativos por dia, para a missão de tempo. Nunca entra no ranking do feed.</span>
          </span>
          <input type="checkbox" checked={draft.count_time} onChange={(e) => set({ count_time: e.target.checked })} className="h-5 w-5 accent-brand-600" />
        </label>
      </Section>

      <div className="sticky bottom-24 z-10 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 dark:bg-[#0b0d0c]/95">
        <button type="button" onClick={save} className="min-h-12 w-full rounded-full bg-brand-600 font-extrabold text-white shadow-lg shadow-brand-600/20">
          Salvar preferências
        </button>
        {status && <p role="status" className="mt-2 text-center text-sm text-brand-600">{status}</p>}
        {error && <p role="alert" className="mt-2 text-center text-sm text-rose-600">{error}</p>}
      </div>

      <Section
        title="O que o algoritmo aprendeu"
        hint="Aprende só com curtidas, reposts, respostas e “mais/menos disto”. Nunca com tempo de tela. Cada aprendizado perde metade da força a cada 14 dias."
      >
        {data.learned.topics.length + data.learned.authors.length === 0 ? (
          <p className="text-sm text-zinc-400">Nada ainda.</p>
        ) : (
          <>
            <ul>
              {data.learned.topics.map((t) => <LearnedBar key={t.topic} label={t.label} value={t.value} />)}
              {data.learned.authors.map((a) => <LearnedBar key={a.author_id} label={`@${a.username}`} value={a.value} />)}
            </ul>
            <button type="button" onClick={resetLearning} className="mt-3 min-h-11 rounded-full bg-zinc-100 px-4 text-sm font-extrabold dark:bg-zinc-900">
              Apagar aprendizado
            </button>
          </>
        )}
        <p className="mt-4 text-sm">
          <a href="/api/feed/algoritmo" target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline">
            Ver a especificação completa do algoritmo
          </a>
        </p>
      </Section>
    </>
  );
}
