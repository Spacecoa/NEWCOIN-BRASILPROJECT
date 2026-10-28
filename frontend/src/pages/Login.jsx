import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { ruleLabel } from '../lib/rules.js';
import AuthForm, { Field, Link, PasswordField } from './AuthForm.jsx';

const APPEAL_LABEL = { aberto: 'Seu recurso está em análise.', negado: 'Seu recurso foi analisado e a suspensão foi mantida.' };

/** Conta suspensa: diz por quê (regra e nota) e permite um recurso com o mesmo e-mail e senha. */
function Suspended({ s, onAppealed }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/recursos/suspensao', { method: 'POST', body: { email: s.email, password: s.password, text } });
      onAppealed();
    } catch (err) {
      setError(err.details?.map((d) => d.message).join(' · ') || err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-zinc-900 dark:text-rose-200">
      <p className="font-extrabold">Esta conta foi suspensa pela moderação da instância.</p>
      {s.rule && <p>Motivo: <b>{ruleLabel(s.rule)}</b>{s.note ? ` · ${s.note}` : ''}</p>}
      {s.since && <p className="text-xs opacity-80">Desde {new Date(s.since).toLocaleDateString('pt-BR')}.</p>}
      {s.appeal_status && <p className="font-semibold">{APPEAL_LABEL[s.appeal_status]}{s.appeal_note ? ` Nota: ${s.appeal_note}` : ''}</p>}
      {s.can_appeal && (
        <form onSubmit={send} className="space-y-2">
          <label className="block">
            <span className="mb-1 block font-semibold">Recorrer da decisão</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              minLength={10}
              maxLength={1000}
              rows={3}
              required
              placeholder="Explique por que a decisão deveria ser revista."
              className="w-full rounded-2xl bg-white px-4 py-3 text-base text-zinc-900 outline-none dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          {error && <p className="text-rose-700 dark:text-rose-300">{error}</p>}
          <button disabled={busy} className="min-h-11 rounded-full bg-zinc-900 px-5 font-extrabold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
            Enviar recurso
          </button>
        </form>
      )}
      <p className="text-xs"><Link to="/regras" className="underline">Ler as regras da instância</Link></p>
    </section>
  );
}

export default function Login() {
  const { login, notice } = useAuth();
  const [suspension, setSuspension] = useState(null);

  async function submit(f) {
    const email = String(f.get('email')).trim();
    const password = f.get('password');
    setSuspension(null);
    try {
      await login(email, password);
    } catch (err) {
      if (err.body?.suspension) return setSuspension({ ...err.body.suspension, email, password });
      throw err;
    }
  }

  // Tela própria (fora do formulário de login: um formulário não pode ficar dentro do outro).
  if (suspension) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4">
          <p className="text-3xl font-extrabold tracking-tight text-brand-600">ágora</p>
          <h1 className="text-xl font-bold">Conta suspensa</h1>
          <Suspended s={suspension} onAppealed={() => setSuspension((s) => ({ ...s, appeal_status: 'aberto', can_appeal: false }))} />
          <button type="button" onClick={() => setSuspension(null)} className="min-h-11 rounded-full px-4 text-sm text-zinc-600 dark:text-zinc-300">
            Voltar para entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthForm
      title="Entrar"
      submitLabel="Entrar"
      notice={notice}
      onSubmit={submit}
      footer={
        <>
          Não tem conta? <Link to="/cadastro" className="text-brand-600 hover:underline">Cadastre-se</Link>. Dados de teste: <code>ana_dev@exemplo.test</code> / <code>senha1234</code>
        </>
      }
    >
      <Field label="E-mail" name="email" type="email" inputMode="email" autoComplete="email" required autoFocus />
      <PasswordField label="Senha" name="password" autoComplete="current-password" required />
    </AuthForm>
  );
}
