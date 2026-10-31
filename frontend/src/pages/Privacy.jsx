import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { DeleteAccount, DownloadData } from '../components/AccountData.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { loadConsent } from '../lib/consent.js';
import { block, mute, RESOLUTION_LABEL, STATUS_LABEL } from '../lib/moderation.js';
import { ruleLabel } from '../lib/rules.js';
import { relativeTime } from '../lib/time.js';

function Section({ title, hint, children }) {
  return (
    <section className="px-4 py-4">
      <h2 className="text-lg font-extrabold">{title}</h2>
      {hint && <p className="mb-2 text-sm text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

function PeopleList({ people, empty, actionLabel, onAction }) {
  if (!people) return <p className="text-sm text-zinc-400">Carregando…</p>;
  if (!people.length) return <p className="text-sm text-zinc-400">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
      {people.map((u) => (
        <li key={u.id} className="flex min-h-14 items-center justify-between gap-3">
          <Link to={`/u/${u.username}`} className="min-w-0">
            <b className="block truncate">{u.display_name}</b>
            <span className="text-sm text-zinc-500">@{u.username} · desde {relativeTime(u.since)}</span>
          </Link>
          <button type="button" onClick={() => onAction(u)} className="min-h-11 shrink-0 rounded-full bg-zinc-100 px-4 text-sm font-extrabold dark:bg-zinc-900">
            {actionLabel}
          </button>
        </li>
      ))}
    </ul>
  );
}

const KIND_LABEL = { post_removido: 'Post removido', suspensao: 'Conta suspensa' };
const APPEAL_STATUS = { aberto: 'Recurso em análise', aceito: 'Recurso aceito: decisão desfeita', negado: 'Recurso negado: decisão mantida' };

/** Uma decisão da moderação sobre a própria conta, com a regra citada e o recurso. */
function Decision({ d, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  async function send(e) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/conta/decisoes/${d.id}/recurso`, { method: 'POST', body: { text } });
      onChange({ ...d, appeal_status: 'aberto', appeal_text: text });
    } catch (err) {
      setError(err.details?.map((x) => x.message).join(' · ') || err.message);
    }
  }
  return (
    <li className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <b>{KIND_LABEL[d.kind]}</b>
        <span className="text-xs text-zinc-500">{relativeTime(d.created_at)}</span>
      </div>
      {d.post_text && <p className="mt-1 text-zinc-500">“{d.post_text}”</p>}
      <p className="mt-1">Motivo: <b>{ruleLabel(d.rule)}</b>{d.note ? ` · ${d.note}` : ''}</p>
      {d.appeal_status && (
        <p className="mt-1 font-semibold">{APPEAL_STATUS[d.appeal_status]}{d.appeal_note ? <span className="font-normal text-zinc-500"> · {d.appeal_note}</span> : ''}</p>
      )}
      {d.reverted_at && !d.appeal_status && <p className="mt-1 font-semibold">A moderação desfez esta decisão.</p>}
      {!d.appeal_status && !d.reverted_at && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 min-h-11 rounded-full bg-white px-4 font-extrabold dark:bg-zinc-950">Recorrer</button>
      )}
      {open && !d.appeal_status && (
        <form onSubmit={send} className="mt-2 space-y-2">
          <label className="block">
            <span className="mb-1 block text-zinc-500">Por que a decisão deveria ser revista? (um recurso por decisão)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} minLength={10} maxLength={1000} rows={3} required className="w-full rounded-2xl bg-white px-4 py-3 text-base outline-none dark:bg-zinc-950" />
          </label>
          {error && <p role="alert" className="text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button className="min-h-11 rounded-full bg-brand-600 px-5 font-extrabold text-white">Enviar recurso</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-full px-4 text-zinc-600 dark:text-zinc-300">Cancelar</button>
          </div>
        </form>
      )}
    </li>
  );
}

/** Quem vê o quê no piloto, em poucas linhas, com os controles que a pessoa tem. */
const VISIBILITY = [
  ['Público', 'Seus posts, respostas e perfil (nome, bio, quem você segue): as pessoas da instância e visitantes que abrirem o endereço dela.'],
  ['Restrito', 'Mensagens de canais: quem tem conta na instância. Mensagens de grupos: só quem é membro. Denúncias e recursos: só a moderação.'],
  ['Só você', 'Esta página, sua carteira, suas notificações e o que o feed "Para você" aprendeu, que fica só neste aparelho.'],
  ['Não guardamos', 'Seu IP no banco, a localização das fotos, anúncios ou rastreadores de outras empresas. O app não se conecta ao X nem ao Telegram.'],
];

const day = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

function PilotSummary() {
  const { user } = useAuth();
  const [term, setTerm] = useState(null);
  useEffect(() => {
    loadConsent().then(setTerm, () => setTerm(false));
  }, []);
  const consent = user?.consent;
  return (
    <div className="space-y-3 text-sm">
      <dl className="divide-y divide-zinc-100 rounded-2xl bg-zinc-50 dark:divide-zinc-800 dark:bg-zinc-900">
        {VISIBILITY.map(([title, text]) => (
          <div key={title} className="p-4">
            <dt className="font-extrabold">{title}</dt>
            <dd className="mt-0.5 text-zinc-600 dark:text-zinc-300">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-zinc-600 dark:text-zinc-300">
        {consent?.accepted_at && !consent.pending ? <>Você aceitou o termo do piloto em {day(consent.accepted_at)}. </> : null}
        <Link to="/termo" className="font-extrabold text-brand-600 hover:underline">Ler o termo do piloto</Link>
        {' · '}
        <Link to="/interesses" className="font-extrabold text-brand-600 hover:underline">Contagem de tempo e o que o feed aprendeu</Link>
      </p>
      {term && <p className="text-zinc-500">Dúvidas ou pedidos sobre seus dados: {term.contact}.</p>}
    </div>
  );
}

/** Seus dados (baixar e excluir), bloqueados, silenciados e o andamento das denúncias que a pessoa fez. */
export default function Privacy() {
  const [blocks, setBlocks] = useState(null);
  const [mutes, setMutes] = useState(null);
  const [reports, setReports] = useState(null);
  const [decisions, setDecisions] = useState(null);

  useEffect(() => {
    api('/api/conta/bloqueados').then((r) => setBlocks(r.data));
    api('/api/conta/silenciados').then((r) => setMutes(r.data));
    api('/api/denuncias').then((r) => setReports(r.data));
    api('/api/conta/decisoes').then((r) => setDecisions(r.data));
  }, []);

  return (
    <>
      <PageHeader back title="Privacidade e dados" subtitle="Só você vê esta página" />
      <Section title="Quem vê o quê" hint="O Ágora está em piloto de pesquisa. Participar é voluntário: você pode sair quando quiser.">
        <PilotSummary />
      </Section>
      <Section title="Seus dados" hint="Você pode levar uma cópia de tudo ou apagar sua conta quando quiser, sem pedir a ninguém.">
        <div className="space-y-3">
          <DownloadData />
          <DeleteAccount />
        </div>
      </Section>
      {decisions?.length > 0 && (
        <Section title="Decisões sobre sua conta" hint="O que a moderação decidiu sobre seus posts, com a regra citada. Cada decisão aceita um recurso.">
          <ul className="space-y-3">
            {decisions.map((d) => (
              <Decision key={d.id} d={d} onChange={(nd) => setDecisions((list) => list.map((x) => (x.id === nd.id ? nd : x)))} />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Bloqueados" hint="Vocês não veem os posts um do outro e ninguém consegue seguir, responder ou curtir o outro.">
        <PeopleList
          people={blocks}
          empty="Você não bloqueou ninguém."
          actionLabel="Desbloquear"
          onAction={async (u) => {
            await block(u.username, false);
            setBlocks((list) => list.filter((x) => x.id !== u.id));
          }}
        />
      </Section>
      <Section title="Silenciados" hint="Os posts não aparecem nos seus feeds nem nas menções. A pessoa não fica sabendo.">
        <PeopleList
          people={mutes}
          empty="Você não silenciou ninguém."
          actionLabel="Deixar de silenciar"
          onAction={async (u) => {
            await mute(u.username, false);
            setMutes((list) => list.filter((x) => x.id !== u.id));
          }}
        />
      </Section>
      <Section title="Suas denúncias" hint="A moderação da instância analisa cada uma. Quem foi denunciado não sabe quem denunciou.">
        {!reports ? (
          <p className="text-sm text-zinc-400">Carregando…</p>
        ) : !reports.length ? (
          <p className="text-sm text-zinc-400">Você não fez nenhuma denúncia.</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
                <div className="flex items-center justify-between gap-2">
                  <b>{r.post_text != null ? `Post de @${r.target_username}` : `Conta @${r.target_username}`}</b>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${r.status === 'aberta' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-brand-50 text-brand-700 dark:bg-zinc-800 dark:text-brand-500'}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                {r.post_text && <p className="mt-1 line-clamp-2 text-zinc-500">“{r.post_text}”</p>}
                <p className="mt-1 text-zinc-500">Enviada {relativeTime(r.created_at)}</p>
                {r.resolution && (
                  <p className="mt-1">
                    {RESOLUTION_LABEL[r.resolution]} {r.rule && <b>{ruleLabel(r.rule)}.</b>} {r.resolution_note && <span className="text-zinc-500">Nota: {r.resolution_note}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
