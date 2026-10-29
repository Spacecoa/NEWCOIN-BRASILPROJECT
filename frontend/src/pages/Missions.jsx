import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

function inviteUrl(path) {
  return `${window.location.origin}${path}`;
}

function CopyLink({ path }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(path);
  async function copy(e) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      e.currentTarget.parentElement.querySelector('input')?.select();
    }
  }
  return (
    <div className="mt-2 flex gap-2">
      <label className="sr-only" htmlFor={`inv-${path}`}>Link do convite</label>
      <input id={`inv-${path}`} readOnly value={url} onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-sm dark:bg-zinc-800" />
      <button type="button" onClick={copy} className="min-h-11 rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white">
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function Suggestion({ s }) {
  const cls = 'block min-h-11 rounded-2xl bg-white px-3 py-2 text-sm hover:ring-2 hover:ring-brand-500/30 dark:bg-zinc-800';
  if (s.type === 'user')
    return (
      <Link to={`/u/${s.username}`} className={cls}>
        <span className="font-extrabold">{s.display_name}</span> <span className="text-zinc-500">@{s.username}</span>
      </Link>
    );
  if (s.type === 'post')
    return (
      <Link to={`/post/${s.id}`} className={cls}>
        <span className="text-zinc-500">@{s.username}: </span>
        <span className="line-clamp-2">{s.text}</span>
      </Link>
    );
  return (
    <Link to={`/canais/${s.slug}`} className={cls}>
      <span className="font-extrabold">{s.title}</span>
    </Link>
  );
}

function MissionCard({ m, onSkip, onInvite, invite, symbol }) {
  const done = m.status === 'done';
  const skipped = m.status === 'skipped';
  return (
    <li className={`rounded-3xl p-4 ${done ? 'bg-brand-50 dark:bg-brand-600/10' : 'bg-zinc-50 dark:bg-zinc-900'} ${skipped ? 'opacity-50' : ''}`}>
      <div className="flex gap-3">
        <span className={`mt-0.5 ${done ? 'text-brand-600' : 'text-zinc-300 dark:text-zinc-700'}`}>
          <Icon name={done ? 'check' : 'circle'} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-extrabold">{m.title}</h3>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold tabular-nums ${done ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 dark:bg-zinc-800 dark:text-brand-100'}`}>
              +{m.reward} {symbol}
            </span>
          </div>
          <p className="text-sm">{m.description}</p>
          <p className="mt-1 text-sm text-zinc-500">{m.why}</p>
          {m.progress && !done && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>
                  {m.progress.current} de {m.progress.target}
                  {m.id === 'tempo_no_app' ? ' min' : ''}
                  {m.progress.authors_needed ? ` · ${m.progress.authors} de ${m.progress.authors_needed} pessoas diferentes` : ''}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label={`Progresso: ${m.title}`} aria-valuenow={m.progress.current} aria-valuemin={0} aria-valuemax={m.progress.target}>
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((m.progress.current / m.progress.target) * 100)}%` }} />
              </div>
            </div>
          )}
          {done && <p className="mt-2 text-sm font-semibold text-brand-700 dark:text-brand-100">Feito. {m.reward} {symbol} creditados na sua carteira.</p>}
          {skipped && <p className="mt-2 text-sm text-zinc-500">Pulada hoje.</p>}
          {m.status === 'todo' && (
            <>
              {m.suggestions.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {m.suggestions.map((s) => <Suggestion key={s.username ?? s.id ?? s.slug} s={s} />)}
                </div>
              )}
              {m.id === 'convidar' && (
                <div className="mt-3">
                  {invite ? (
                    <CopyLink path={invite.path} />
                  ) : (
                    <button type="button" onClick={onInvite} className="min-h-11 rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white">
                      Gerar convite
                    </button>
                  )}
                </div>
              )}
              {m.id === 'organizar' && (
                <Link to="/canais" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white">
                  Criar um grupo
                </Link>
              )}
              {m.id === 'apresentar' && (
                <Link to="/" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white">
                  Escrever meu post
                </Link>
              )}
              <div className="mt-2">
                <button type="button" onClick={() => onSkip(m.id)} className="-ml-2 min-h-11 rounded-full px-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                  Pular hoje
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function Collective({ c }) {
  const goal = c.novos_membros_semana;
  const pct = goal ? Math.round((c.recebidos_semana / goal) * 100) : 100;
  return (
    <section className="mx-4 rounded-3xl bg-zinc-50 p-4 dark:bg-zinc-900" aria-label="A rede hoje">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-zinc-500">A rede, junta</h2>
      <p className="mt-1 font-extrabold">
        {goal ? `${c.recebidos_semana} de ${goal} pessoas novas desta semana já foram recebidas` : 'Ninguém novo nesta semana ainda'}
      </p>
      <p className="text-sm text-zinc-500">Meta coletiva: nenhuma pessoa nova sem resposta.</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          [c.perguntas_respondidas_hoje, 'perguntas respondidas hoje'],
          [c.grupos_ativos_hoje, 'grupos com conversa hoje'],
          [c.convites_aceitos_semana, 'convites aceitos na semana'],
        ].map(([n, label]) => (
          <p key={label}>
            <span className="block text-2xl font-extrabold tabular-nums">{n}</span>
            <span className="block text-xs text-zinc-500">{label}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

export default function Missions() {
  const [data, setData] = useState(null);
  const [invites, setInvites] = useState([]);
  const [newInvite, setNewInvite] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    Promise.all([api('/api/missoes'), api('/api/convites')])
      .then(([m, inv]) => {
        setData(m);
        setInvites(inv.data);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function skip(id) {
    await api(`/api/missoes/${id}/pular`, { method: 'POST' });
    load();
  }

  async function invite() {
    try {
      const { data: inv } = await api('/api/convites', { method: 'POST' });
      setNewInvite(inv);
      setInvites((prev) => [inv, ...prev]);
    } catch (e) {
      setError(e.message);
    }
  }

  async function setEnabled(enabled) {
    await api('/api/feed/preferencias', { method: 'PUT', body: { missions_enabled: enabled } });
    load();
  }

  if (error && !data) return <p className="p-8 text-center text-zinc-500">{error}</p>;
  if (!data) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const cardOffersInvite = data.enabled && data.missions.some((m) => m.id === 'convidar' && m.status === 'todo');

  return (
    <>
      <PageHeader back title="Missões do dia" subtitle="Ações dentro do app que fazem a rede crescer" />
      {data.token && (
        <Link to="/carteira" className="mx-4 mb-3 flex min-h-14 items-center gap-3 rounded-3xl bg-brand-600 px-4 py-3 text-white">
          <Icon name="coin" className="h-7 w-7" />
          <span className="min-w-0 flex-1">
            <span className="block text-2xl font-extrabold tabular-nums leading-tight">
              {data.token.balance} {data.token.symbol}
            </span>
            <span className="block text-sm text-brand-100">+{data.token.earned_today} hoje com missões · ver carteira</span>
          </span>
        </Link>
      )}
      <Collective c={data.collective} />

      {data.enabled ? (
        <section className="px-4 py-4" aria-label="Suas missões">
          <p className="mb-3 text-sm text-zinc-500">
            {data.summary.done} de {data.summary.total} hoje. Renovam à meia-noite.
          </p>
          <ul className="grid gap-3">
            {data.missions.map((m) => (
              <MissionCard key={m.id} m={m} onSkip={skip} onInvite={invite} invite={newInvite} symbol={data.token?.symbol ?? 'NWC'} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="px-4 py-6 text-center">
          <p className="text-zinc-500">Você escondeu as missões.</p>
          <button type="button" onClick={() => setEnabled(true)} className="mt-2 min-h-11 rounded-full bg-zinc-100 px-4 font-extrabold dark:bg-zinc-900">
            Mostrar missões
          </button>
        </section>
      )}

      <section className="px-4 py-2" aria-label="Seus convites">
        <h2 className="font-extrabold">Seus convites</h2>
        <p className="mt-1 text-sm text-zinc-500">Cada convite vale para uma pessoa. Convide quem você conhece e confia.</p>
        {/* A missão "convidar" só sai em alguns dias; convidar fica sempre disponível aqui. */}
        {!cardOffersInvite && (
          <div className="mt-2">
            {newInvite ? (
              <CopyLink path={newInvite.path} />
            ) : (
              <button type="button" onClick={invite} className="min-h-11 rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white">
                Gerar convite
              </button>
            )}
          </div>
        )}
        {invites.length > 0 && (
          <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {invites.map((i) => (
              <li key={i.code} className="flex min-h-11 items-center justify-between gap-2">
                <span className="font-mono">{i.code}</span>
                <span className="text-zinc-500">{i.used ? `aceito por @${i.used_by_username ?? 'conta removida'}` : 'aguardando'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 py-6 text-sm text-zinc-500" aria-label="Como as missões funcionam">
        <h2 className="mb-1 font-extrabold text-zinc-900 dark:text-white">Como funcionam</h2>
        <ul className="list-disc space-y-1 pl-5">
          {data.principles.map((p) => <li key={p}>{p}</li>)}
        </ul>
        {data.enabled && (
          <button type="button" onClick={() => setEnabled(false)} className="mt-3 min-h-11 rounded-full px-0 font-semibold text-zinc-500 underline">
            Esconder missões
          </button>
        )}
      </section>
    </>
  );
}
