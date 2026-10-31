import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import ConsentText from '../components/ConsentText.jsx';
import RulesList from '../components/RulesList.jsx';
import { loadConsent } from '../lib/consent.js';
import { loadRules } from '../lib/rules.js';
import AuthForm, { Field, Link } from './AuthForm.jsx';

export default function Register() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const invite = params.get('convite')?.trim().toLowerCase() || undefined;
  const [rules, setRules] = useState(null);
  const [term, setTerm] = useState(null);
  useEffect(() => {
    loadRules().then((d) => setRules(d.rules)).catch(() => setRules([]));
    loadConsent().then(setTerm).catch(() => setTerm(false));
  }, []);
  return (
    <AuthForm
      title={invite ? 'Você foi convidada(o)' : 'Criar conta'}
      submitLabel="Cadastrar"
      onSubmit={(f) =>
        register({
          username: f.get('username'),
          display_name: f.get('display_name') || undefined,
          email: f.get('email'),
          password: f.get('password'),
          invite_code: invite,
          accept_rules: f.get('accept_rules') === 'on',
          accept_consent: f.get('accept_consent') === 'on',
          consent_version: term?.version,
        })
      }
      footer={<>Já tem conta? <Link to="/login" className="text-brand-600 hover:underline">Entrar</Link></>}
    >
      <Field label="Usuário (3–20: letras, números, _)" name="username" pattern="[A-Za-z0-9_]{3,20}" required />
      <Field label="Nome de exibição" name="display_name" maxLength={50} />
      <Field label="E-mail" name="email" type="email" autoComplete="email" required />
      <Field label="Senha (mín. 8)" name="password" type="password" minLength={8} autoComplete="new-password" required />
      <details className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900" open>
        <summary className="cursor-pointer font-semibold">Regras desta instância{rules?.length ? ` (${rules.length})` : ''}</summary>
        <div className="mt-3">{rules ? <RulesList rules={rules} compact /> : <p className="text-zinc-400">Carregando…</p>}</div>
      </details>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="accept_rules" required className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
        <span>Li e aceito as regras da instância. Sei que a moderação pode remover posts ou suspender contas que as quebrem, e que posso recorrer.</span>
      </label>
      <details className="rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
        <summary className="cursor-pointer font-semibold">Termo de consentimento do piloto</summary>
        <div className="mt-3">
          {term ? <ConsentText term={term} compact /> : term === false ? <p className="text-rose-600">Não deu para carregar o termo. Recarregue a página.</p> : <p className="text-zinc-400">Carregando…</p>}
          <Link to="/termo" className="mt-3 inline-block font-semibold text-brand-600 hover:underline">Abrir o termo numa página</Link>
        </div>
      </details>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="accept_consent" required className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
        <span>{term?.accept_label ?? 'Tenho 18 anos ou mais, li o termo e aceito participar do piloto. Sei que posso sair quando quiser.'}</span>
      </label>
    </AuthForm>
  );
}
