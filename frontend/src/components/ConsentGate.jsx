import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { loadConsent } from '../lib/consent.js';
import { DeleteAccount, DownloadData } from './AccountData.jsx';
import ConsentText from './ConsentText.jsx';
import LoadError from './LoadError.jsx';

/**
 * Conta que ainda não aceitou a versão atual do termo (conta antiga, ou o termo mudou):
 * antes de seguir no app, a pessoa lê e aceita, ou leva os dados e sai.
 */
export default function ConsentGate() {
  const { user, updateUser, logout } = useAuth();
  const [term, setTerm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    loadConsent().then(setTerm, setError);
  }, []);

  async function accept(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/api/conta/termo', { method: 'POST', body: { version: term.version } });
      updateUser(res.user);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-6 text-sm">
      <p className="text-2xl font-extrabold tracking-tight text-brand-600">ágora</p>
      <h1 className="mt-4 text-xl font-extrabold">{user.consent?.version ? 'O termo do piloto mudou' : 'Termo do piloto'}</h1>
      <p className="mt-1 text-zinc-500">Antes de continuar, leia o que o app guarda e para quê. Se não quiser participar, você pode levar seus dados e excluir a conta.</p>
      {error && <div className="mt-4"><LoadError message={error.message} className="p-4" /></div>}
      {!term ? (
        !error && <p className="mt-4 text-zinc-400">Carregando…</p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <ConsentText term={term} compact />
          </div>
          <form onSubmit={accept} className="mt-4 space-y-3">
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" required className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
              <span>{term.accept_label}</span>
            </label>
            <button disabled={busy} className="min-h-11 w-full rounded-full bg-brand-600 px-5 font-extrabold text-white disabled:opacity-60">
              {busy ? 'Salvando…' : 'Aceito e continuo'}
            </button>
          </form>
          {!leaving ? (
            <button type="button" onClick={() => setLeaving(true)} className="mt-3 min-h-11 w-full rounded-full bg-zinc-100 px-5 font-extrabold dark:bg-zinc-900">
              Não aceito
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              <p>Tudo bem. Você pode baixar seus dados e excluir a conta, ou só sair e decidir depois.</p>
              <DownloadData />
              <DeleteAccount />
              <button type="button" onClick={logout} className="min-h-11 rounded-full px-4 text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300">
                Sair e decidir depois
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
