import { useAuth } from '../auth/AuthContext.jsx';
import AuthForm, { Field, Link } from './AuthForm.jsx';

export default function Login() {
  const { login } = useAuth();
  return (
    <AuthForm
      title="Entrar"
      submitLabel="Entrar"
      onSubmit={(f) => login(f.get('login'), f.get('password'))}
      footer={<>Não tem conta? <Link to="/cadastro" className="text-brand-600 hover:underline">Cadastre-se</Link>. Dados de teste: <code>ana_dev</code> / <code>senha1234</code></>}
    >
      <Field label="E-mail ou usuário" name="login" autoComplete="username" required />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" required />
    </AuthForm>
  );
}
