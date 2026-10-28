import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { block, mute, RESOLUTION_LABEL, STATUS_LABEL } from '../lib/moderation.js';
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

/** Bloqueados, silenciados e o andamento das denúncias que a pessoa fez. */
export default function Privacy() {
  const [blocks, setBlocks] = useState(null);
  const [mutes, setMutes] = useState(null);
  const [reports, setReports] = useState(null);

  useEffect(() => {
    api('/api/conta/bloqueados').then((r) => setBlocks(r.data));
    api('/api/conta/silenciados').then((r) => setMutes(r.data));
    api('/api/denuncias').then((r) => setReports(r.data));
  }, []);

  return (
    <>
      <PageHeader back title="Bloqueios e denúncias" subtitle="Só você vê esta página" />
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
                {r.resolution && <p className="mt-1">{RESOLUTION_LABEL[r.resolution]} {r.resolution_note && <span className="text-zinc-500">Nota: {r.resolution_note}</span>}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
