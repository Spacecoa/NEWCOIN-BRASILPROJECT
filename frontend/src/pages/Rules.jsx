import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import RulesList from '../components/RulesList.jsx';
import { api } from '../lib/api.js';
import { loadRules, setRulesCache } from '../lib/rules.js';

/** Editor da moderação: ordem = numeração; regra retirada fica arquivada no servidor. */
function RulesEditor({ rules, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => rules.map((r) => ({ ...r })));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (i, patch) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i, dir) =>
    setDraft((d) => {
      const n = [...d];
      const j = i + dir;
      if (j < 0 || j >= n.length) return d;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { rules: draft.map(({ id, title, description }) => ({ ...(id ? { id } : {}), title, description })) };
      const res = await api('/api/moderacao/regras', { method: 'PUT', body });
      setRulesCache(res.data);
      onSaved(res.data);
    } catch (err) {
      setError(err.details?.map((d) => d.message).join(' · ') || err.message);
      setBusy(false);
    }
  }

  const input = 'w-full rounded-2xl bg-white px-4 outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-950';
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        A ordem define a numeração. Uma regra retirada fica arquivada: decisões antigas continuam mostrando o texto que valia na época.
      </p>
      {draft.map((r, i) => (
        <fieldset key={r.id ?? `novo-${i}`} className="space-y-2 rounded-3xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <legend className="sr-only">Regra {i + 1}</legend>
          <div className="flex items-center justify-between gap-2">
            <b className="text-sm">Regra {i + 1}</b>
            <div className="flex gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir regra ${i + 1}`} className="h-9 w-9 rounded-full bg-white disabled:opacity-30 dark:bg-zinc-950">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label={`Descer regra ${i + 1}`} className="h-9 w-9 rounded-full bg-white disabled:opacity-30 dark:bg-zinc-950">↓</button>
              <button type="button" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} aria-label={`Retirar regra ${i + 1}`} className="h-9 rounded-full bg-white px-3 text-sm text-rose-600 dark:bg-zinc-950">Retirar</button>
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Título</span>
            <input value={r.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} className={`${input} min-h-11`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Explicação</span>
            <textarea value={r.description} maxLength={500} rows={2} onChange={(e) => set(i, { description: e.target.value })} className={`${input} py-2`} />
          </label>
        </fieldset>
      ))}
      {draft.length < 15 && (
        <button type="button" onClick={() => setDraft((d) => [...d, { title: '', description: '' }])} className="min-h-11 rounded-full bg-zinc-100 px-5 font-extrabold dark:bg-zinc-900">
          + Adicionar regra
        </button>
      )}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="min-h-12 flex-1 rounded-full bg-brand-600 font-extrabold text-white disabled:opacity-50">Salvar regras</button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-full px-5 text-zinc-600 dark:text-zinc-300">Cancelar</button>
      </div>
    </div>
  );
}

/** Página pública: as regras, quem modera, como as decisões funcionam e como recorrer. */
export default function Rules() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    loadRules({ fresh: true }).then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className={user ? '' : 'mx-auto max-w-xl pb-10'}>
      <PageHeader back title="Regras da instância" subtitle={data?.updated_at ? `Atualizadas em ${new Date(data.updated_at).toLocaleDateString('pt-BR')}` : 'Valem para todas as pessoas daqui'} />
      <div className="space-y-6 px-4 pb-8">
        {error && <p role="alert" className="text-zinc-500">{error}</p>}
        {!data && !error && <p className="text-zinc-400">Carregando…</p>}
        {data && (editing ? (
          <RulesEditor rules={data.rules} onSaved={(d) => { setData(d); setEditing(false); }} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-300">
              Estas regras valem para todas as pessoas desta instância. Quem se cadastra aceita as regras. Quando a moderação remove um post ou suspende uma
              conta, ela diz qual regra foi quebrada.
            </p>
            <RulesList rules={data.rules} />
            {user?.is_moderator && (
              <button type="button" onClick={() => setEditing(true)} className="min-h-11 rounded-full bg-zinc-100 px-5 font-extrabold dark:bg-zinc-900">Editar regras</button>
            )}
            <section className="space-y-2 rounded-3xl bg-zinc-50 p-5 text-sm dark:bg-zinc-900">
              <h2 className="text-base font-extrabold">Como a moderação decide</h2>
              <ul className="list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
                <li><b>Arquivar:</b> a denúncia não mostrou violação; nada muda.</li>
                <li><b>Remover post:</b> o post sai do ar, citando a regra.</li>
                <li><b>Suspender conta:</b> a conta não entra mais, citando a regra.</li>
              </ul>
              <h2 className="pt-2 text-base font-extrabold">Como recorrer</h2>
              <p className="text-zinc-600 dark:text-zinc-300">
                Cada decisão aceita um recurso. Post removido: em <b>Perfil › Bloqueios e denúncias</b>. Conta suspensa: na tela de entrar, com e-mail e senha.
                Se o recurso for aceito, o post volta ou a conta é reativada.
              </p>
            </section>
            {data.moderators.length > 0 && (
              <section className="text-sm">
                <h2 className="mb-1 text-base font-extrabold">Quem modera</h2>
                <p className="text-zinc-600 dark:text-zinc-300">
                  {data.moderators.map((m, i) => (
                    <span key={m.username}>
                      {i > 0 && ', '}
                      {user ? <Link to={`/u/${m.username}`} className="text-brand-600">@{m.username}</Link> : `@${m.username}`}
                    </span>
                  ))}
                </p>
              </section>
            )}
            {!user && (
              <p className="text-sm">
                <Link to="/cadastro" className="font-extrabold text-brand-600">Criar conta</Link> · <Link to="/login" className="text-brand-600">Entrar</Link>
              </p>
            )}
          </>
        ))}
      </div>
    </div>
  );
}
