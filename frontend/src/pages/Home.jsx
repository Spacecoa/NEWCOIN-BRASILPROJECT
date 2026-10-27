import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { createDeviceSource } from '../lib/deviceAlgo.js';
import { useRankingMode } from '../lib/rankingMode.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Link } from 'react-router';
import ComposeSheet from '../components/ComposeSheet.jsx';
import Composer from '../components/Composer.jsx';
import Feed from '../components/Feed.jsx';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';

const TAB_KEY = 'agora.homeTab';
const readTab = () => {
  try {
    return localStorage.getItem(TAB_KEY) === 'interesses' ? 'interesses' : 'seguindo';
  } catch {
    return 'seguindo';
  }
};

function CaughtUp({ meta, onSwitch }) {
  return (
    <div className="mx-4 my-6 rounded-3xl bg-zinc-50 p-6 text-center dark:bg-zinc-900">
      <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-600/15">
        <Icon name="check" />
      </span>
      <p className="text-lg font-extrabold">Você está em dia</p>
      <p className="mt-1 text-sm text-zinc-500">
        Estes foram os {meta?.session?.delivered ?? ''} posts mais relevantes para você agora. O feed termina aqui de propósito.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onSwitch} className="min-h-11 rounded-full bg-white px-4 text-sm font-extrabold dark:bg-zinc-800">
          Ver Seguindo
        </button>
        <Link to="/interesses" className="flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-extrabold dark:bg-zinc-800">
          Ajustar interesses
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTabState] = useState(readTab);
  const setTab = (t) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* sem armazenamento: a aba vale só nesta visita */
    }
  };
  const interests = tab === 'interesses';
  const { user } = useAuth();
  const mode = useRankingMode();
  // Uma fonte nova por visita à aba: busca os candidatos e ordena neste navegador.
  const deviceSource = useMemo(
    () => (mode === 'device' && user ? createDeviceSource(user.id, () => api('/api/feed/candidatos')) : null),
    [mode, user, tab],
  );
  const [missions, setMissions] = useState(null);
  useEffect(() => {
    api('/api/missoes').then(setMissions).catch(() => setMissions(null));
  }, []);

  return (
    <>
      <PageHeader
        title="Início"
        subtitle={
          interests
            ? mode === 'device'
              ? 'Ordenado neste aparelho pelo algoritmo aberto'
              : 'Ordenado pelo algoritmo aberto, que você controla'
            : 'Quem você segue, do mais novo ao mais antigo'
        }
      >
        <Link
          to="/interesses"
          aria-label="Ajustar meu algoritmo"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <Icon name="sliders" />
        </Link>
      </PageHeader>
      {missions?.enabled && missions.summary.total > 0 && (
        <Link
          to="/missoes"
          className="mx-4 mb-3 flex min-h-12 items-center gap-3 rounded-3xl bg-brand-50 px-4 py-2 text-sm dark:bg-brand-600/15"
        >
          <span className="text-brand-600"><Icon name="sprout" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-extrabold text-brand-700 dark:text-brand-100">Missões do dia</span>
            <span className="block truncate text-zinc-600 dark:text-zinc-300">
              {missions.summary.done} de {missions.summary.total} · +{missions.token.earned_today} {missions.token.symbol} hoje ·{' '}
              {missions.missions.find((m) => m.status === 'todo')?.title ?? 'Tudo feito por hoje'}
            </span>
          </span>
        </Link>
      )}
      <div role="tablist" aria-label="Tipo de feed" className="mx-4 mb-2 grid grid-cols-2 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
        {[
          ['seguindo', 'Seguindo'],
          ['interesses', 'Para você'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-10 rounded-full text-sm ${tab === key ? 'bg-white font-extrabold shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {interests && !mode ? (
        <p className="p-8 text-center text-zinc-500">Carregando…</p>
      ) : interests ? (
        <Feed
          key={`interesses-${mode}`}
          endpoint={mode === 'device' ? 'device:interesses' : '/api/feed/interesses'}
          source={deviceSource ?? undefined}
          cursorParam="next_token"
          autoLoad={false}
          emptyText="Nada novo nos seus interesses. Ajuste seus tópicos ou siga mais pessoas."
          renderEnd={(meta) => <CaughtUp meta={meta} onSwitch={() => setTab('seguindo')} />}
          header={(_prepend, meta) =>
            meta && !meta.personalized ? (
              <Link to="/interesses" className="mx-4 mb-2 block rounded-3xl bg-brand-50 p-4 text-sm dark:bg-brand-600/15">
                <span className="block font-extrabold text-brand-700 dark:text-brand-100">Diga ao Ágora do que você gosta</span>
                <span className="text-zinc-600 dark:text-zinc-300">
                  Você ainda não escolheu tópicos nem palavras-chave, então este feed está quase em ordem de chegada. Toque para escolher.
                </span>
              </Link>
            ) : null
          }
        />
      ) : (
        <Feed
          key="seguindo"
          endpoint="/api/timeline"
          live
          header={(prepend) => (
            <>
              {/* No celular, postar fica no botão flutuante; a partir de md, o campo fica no topo. */}
              <div className="hidden md:block">
                <Composer onPosted={prepend} />
              </div>
              <ComposeSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onPosted={prepend} />
            </>
          )}
          emptyText="Siga pessoas em Explorar para preencher sua timeline."
        />
      )}
      <button
        type="button"
        onClick={() => {
          setTab('seguindo');
          setSheetOpen(true);
        }}
        aria-label="Novo post"
        className="fixed right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 md:hidden"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Icon name="plus" className="h-6 w-6" />
      </button>
    </>
  );
}
