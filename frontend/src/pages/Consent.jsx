import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import ConsentText from '../components/ConsentText.jsx';
import LoadError from '../components/LoadError.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { loadConsent } from '../lib/consent.js';

const date = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** /termo: o termo inteiro, para ler antes de criar a conta ou a qualquer momento depois. */
export default function Consent() {
  const { user } = useAuth();
  const [term, setTerm] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    loadConsent().then(setTerm, setError);
  }, []);
  const accepted = user?.consent && !user.consent.pending ? user.consent : null;
  // Logada, a página já está dentro do <main> do Layout; sem login, ela é a própria região principal.
  const Main = user ? 'div' : 'main';

  return (
    <Main className={user ? '' : 'mx-auto max-w-xl pb-10'}>
      <PageHeader back title="Termo do piloto" subtitle="O que o Ágora guarda, para quê e como sair" />
      <div className="px-4 py-4 text-sm">
        {error ? (
          <LoadError message={error.message} className="p-4" />
        ) : !term ? (
          <p className="text-zinc-400">Carregando…</p>
        ) : (
          <>
            {accepted && (
              <p role="status" className="mb-4 rounded-2xl bg-brand-50 px-4 py-3 text-brand-700 dark:bg-zinc-900 dark:text-brand-500">
                Você aceitou esta versão em {date(accepted.accepted_at)}. Para sair, vá em{' '}
                <Link to="/privacidade" className="font-extrabold underline">Privacidade e dados</Link>.
              </p>
            )}
            <ConsentText term={term} />
            {!user && (
              <Link to="/cadastro" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-600 px-5 font-extrabold text-white">
                Criar conta
              </Link>
            )}
          </>
        )}
      </div>
    </Main>
  );
}
