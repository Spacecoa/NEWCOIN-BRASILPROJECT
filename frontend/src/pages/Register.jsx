import { useAuth } from '../auth/AuthContext.jsx';
import AuthForm, { Field, Link } from './AuthForm.jsx';

export default function Register() {
  const { register } = useAuth();
  return (
    <AuthForm
      title="Criar conta"
      submitLabel="Cadastrar"
      onSubmit={(f) =>
        register({
          username: f.get('username'),
          display_name: f.get('display_name') || undefined,
          email: f.get('email'),
          password: f.get('password'),
        })
      }
      footer={<>Já tem conta? <Link to="/login" className="text-brand-600 hover:underline">Entrar</Link></>}
    >
      <Field label="Usuário (3–20: letras, números, _)" name="username" pattern="[A-Za-z0-9_]{3,20}" required />
      <Field label="Nome de exibição" name="display_name" maxLength={50} />
      <Field label="E-mail" name="email" type="email" autoComplete="email" required />
      <Field label="Senha (mín. 8)" name="password" type="password" minLength={8} autoComplete="new-password" required />
    </AuthForm>
  );
}
