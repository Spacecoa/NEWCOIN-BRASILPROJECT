import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { forgetDevice, hasLocalState, loadState } from '../lib/deviceAlgo.js';

/** Baixa tudo o que a instância guarda sobre a pessoa, num arquivo JSON. */
export function DownloadData() {
  const { user } = useAuth();
  const [state, setState] = useState({ busy: false, error: null, done: false });

  async function download() {
    setState({ busy: true, error: null, done: false });
    try {
      const data = await api('/api/conta/dados');
      // O algoritmo do "Para você" mora só neste aparelho (docs/07 §2.10): vai junto no arquivo.
      if (hasLocalState(user.id)) data.neste_aparelho = { algoritmo: loadState(user.id) };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agora-dados-${data.conta.username}-${data.gerado_em.slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState({ busy: false, error: null, done: true });
    } catch (err) {
      setState({ busy: false, error: err.message, done: false });
    }
  }

  return (
    <div className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
      <b className="block">Baixar meus dados</b>
      <p className="mt-1 text-zinc-500">
        Um arquivo com tudo o que a instância guarda sobre você: conta, posts e edições, imagens, mensagens, curtidas, seguidas,
        carteira, denúncias que você fez e decisões sobre sua conta. O que o feed "Para você" aprendeu neste aparelho vai junto.
      </p>
      <button type="button" onClick={download} disabled={state.busy} className="mt-3 min-h-11 rounded-full bg-white px-5 font-extrabold disabled:opacity-60 dark:bg-zinc-950">
        {state.busy ? 'Preparando…' : 'Baixar arquivo (JSON)'}
      </button>
      {state.done && <p role="status" className="mt-2 text-brand-700 dark:text-brand-500">Arquivo baixado.</p>}
      {state.error && <p role="alert" className="mt-2 text-rose-600">{state.error}</p>}
    </div>
  );
}

/** Excluir a conta de vez: explica o que acontece e pede a senha de novo. */
export function DeleteAccount() {
  const { user, endSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const password = new FormData(e.currentTarget).get('password');
      await api('/api/conta', { method: 'DELETE', body: { password } });
      forgetDevice(user.id); // o algoritmo do "Para você" sai deste aparelho também
      // Como em "Sair": o app volta para a leitura de visitante, com o aviso no topo.
      endSession('Sua conta foi excluída. Seus posts, mensagens, imagens e dados saíram da instância.');
    } catch (err) {
      setError(err.details?.map((x) => x.message).join(' · ') || err.message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-rose-200 p-4 text-sm dark:border-rose-900">
      <b className="block text-rose-700 dark:text-rose-400">Excluir minha conta</b>
      <p className="mt-1 text-zinc-500">Não dá para desfazer. Se quiser guardar uma cópia, baixe seus dados antes.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-11 rounded-full bg-rose-50 px-5 font-extrabold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          Quero excluir minha conta
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <ul className="list-disc space-y-1 pl-5">
            <li>Somem seus posts, imagens, mensagens, curtidas, seguidas, carteira NewCoin e o histórico de uso.</li>
            <li>O que o feed &quot;Para você&quot; aprendeu sai deste aparelho. Nos outros aparelhos em que você usou o app, ele fica no navegador até você limpar os dados do site.</li>
            <li>Respostas de outras pessoas aos seus posts continuam, sem o post original.</li>
            <li>Seus canais com outras pessoas passam para o administrador (ou membro) mais antigo.</li>
            <li>Seu @ fica reservado: ninguém mais poderá usá-lo. O e-mail fica livre.</li>
          </ul>
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" required className="mt-0.5 h-5 w-5 shrink-0 accent-rose-600" />
            <span>Entendi que a exclusão é definitiva.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-500">Sua senha, para confirmar</span>
            <input name="password" type="password" autoComplete="current-password" required className="w-full rounded-2xl bg-zinc-50 px-4 py-3 text-base outline-none dark:bg-zinc-900" />
          </label>
          {error && <p role="alert" className="text-rose-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="min-h-11 rounded-full bg-rose-600 px-5 font-extrabold text-white disabled:opacity-60">
              {busy ? 'Excluindo…' : 'Excluir conta de vez'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-full px-4 text-zinc-600 dark:text-zinc-300">Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
