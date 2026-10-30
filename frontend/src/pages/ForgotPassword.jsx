import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import AuthForm, { Field } from './AuthForm.jsx';

/** Esqueci a senha: pede o link por e-mail. A resposta não diz se o e-mail tem conta. */
export default function ForgotPassword() {
  const [sent, setSent] = useState(null);

  async function submit(f) {
    const { message } = await api('/api/auth/senha/esqueci', { method: 'POST', body: { email: String(f.get('email')).trim() } });
    setSent(message);
  }

  if (sent) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4">
          <p className="text-3xl font-extrabold tracking-tight text-brand-600">ágora</p>
          <h1 className="text-xl font-bold">Confira seu e-mail</h1>
          <p role="status" className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-zinc-900 dark:text-brand-500">{sent}</p>
          <p className="text-sm text-zinc-500">Não chegou? Olhe a caixa de spam ou peça de novo em alguns minutos.</p>
          {import.meta.env.DEV && <p className="text-xs text-zinc-400">No protótipo, o e-mail não é enviado de verdade: o link aparece no log do servidor.</p>}
          <Link to="/login" className="inline-flex min-h-11 items-center rounded-full bg-zinc-100 px-5 font-extrabold dark:bg-zinc-900">
            Voltar para entrar
          </Link>
        </div>
      </main>
    );
  }

  return (
    <AuthForm
      title="Esqueci minha senha"
      submitLabel="Enviar link"
      notice="Diga o e-mail da sua conta. Mandamos um link para você criar uma senha nova."
      onSubmit={submit}
      footer={<>Lembrou? <Link to="/login" className="text-brand-600 hover:underline">Entrar</Link></>}
    >
      <Field label="E-mail" name="email" type="email" inputMode="email" autoComplete="email" required autoFocus />
    </AuthForm>
  );
}
