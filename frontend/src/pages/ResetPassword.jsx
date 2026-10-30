import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { ApiError, api } from '../lib/api.js';
import AuthForm, { PasswordField } from './AuthForm.jsx';

/** Redefinir senha pelo link do e-mail (/redefinir-senha?token=…). */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { endSession } = useAuth();
  // O token sai da barra de endereço assim que é lido: não fica no histórico nem num print.
  const [token] = useState(() => params.get('token'));
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [token]);

  async function submit(f) {
    const password = f.get('password');
    if (password !== f.get('confirm')) throw new ApiError(400, { error: 'As duas senhas não são iguais.' });
    await api('/api/auth/senha/redefinir', { method: 'POST', body: { token, password } });
    // Trocar a senha encerra todas as sessões, inclusive a deste aparelho, se houver.
    endSession('Senha nova salva. Entre com ela.');
    navigate('/login', { replace: true });
  }

  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4">
          <p className="text-3xl font-extrabold tracking-tight text-brand-600">ágora</p>
          <h1 className="text-xl font-bold">Link incompleto</h1>
          <p className="text-zinc-600 dark:text-zinc-300">Abra o link do e-mail inteiro, ou peça um novo.</p>
          <Link to="/esqueci-senha" className="inline-flex min-h-11 items-center rounded-full bg-brand-600 px-5 font-extrabold text-white">
            Pedir um link novo
          </Link>
        </div>
      </main>
    );
  }

  return (
    <AuthForm
      title="Criar uma senha nova"
      submitLabel="Salvar senha nova"
      notice="Depois de salvar, você sai da conta em todos os aparelhos e entra de novo com a senha nova."
      onSubmit={submit}
      footer={<>O link venceu? <Link to="/esqueci-senha" className="text-brand-600 hover:underline">Peça outro</Link></>}
    >
      <PasswordField label="Senha nova (mínimo de 8 caracteres)" name="password" autoComplete="new-password" minLength={8} required autoFocus />
      <PasswordField label="Repita a senha nova" name="confirm" autoComplete="new-password" minLength={8} required />
    </AuthForm>
  );
}
