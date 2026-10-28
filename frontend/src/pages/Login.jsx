import { useAuth } from '../auth/AuthContext.jsx';
import AuthForm, { Field, Link, PasswordField } from './AuthForm.jsx';

export default function Login() {
  const { login, notice } = useAuth();
  return (
    <AuthForm
      title="Entrar"
      submitLabel="Entrar"
      notice={notice}
      onSubmit={(f) => login(String(f.get('email')).trim(), f.get('password'))}
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
