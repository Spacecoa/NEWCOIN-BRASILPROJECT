import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';

// Quem ainda não entrou lê os posts, os perfis e os dados do país, mas não interage.
// A faixa do topo diz isso e leva para entrar ou criar conta, guardando a página de origem.
export default function VisitorLayout() {
  const { pathname, search } = useLocation();
  const { notice, clearNotice } = useAuth();
  const state = { from: pathname + search };
  const items = [
    ['/', 'home', 'Início'],
    ['/brasil', 'chart', 'Brasil'],
    ['/regras', 'book', 'Regras'],
  ];
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <div role="region" aria-label="Aviso para visitantes" className="sticky top-0 z-30 border-b border-zinc-100 bg-white/95 px-4 py-2 backdrop-blur dark:border-zinc-900 dark:bg-[#0b0d0c]/95">
        <div className="flex items-center gap-3">
          <p className="text-xl font-extrabold tracking-tight text-brand-600">ágora</p>
          <p className="min-w-0 flex-1 text-xs text-zinc-500">Você está só lendo. Entre para curtir, repostar, responder, recompensar e seguir.</p>
          <Link to="/login" state={state} className="flex min-h-10 shrink-0 items-center rounded-full bg-brand-600 px-4 text-sm font-extrabold text-white">
            Entrar
          </Link>
          <Link to="/cadastro" state={state} className="hidden min-h-10 shrink-0 items-center rounded-full bg-zinc-100 px-4 text-sm font-extrabold sm:flex dark:bg-zinc-900">
            Criar conta
          </Link>
        </div>
        {/* Quem acabou de sair cai aqui, na versão de leitura da mesma página: o aviso confirma a saída. */}
        {notice && (
          <div role="status" className="mt-2 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-2 text-sm text-brand-700 dark:bg-zinc-900 dark:text-brand-500">
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" onClick={clearNotice} aria-label="Fechar aviso" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <main className="min-w-0 flex-1 pb-24 md:border-x md:border-zinc-100 md:dark:border-zinc-900">
        <Outlet />
      </main>
      <nav aria-label="Principal (visitante)" className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-zinc-100 bg-white/95 backdrop-blur dark:border-zinc-900 dark:bg-[#0b0d0c]/95">
        <div className="mx-auto flex max-w-2xl justify-around px-2">
          {items.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'font-extrabold text-zinc-900 dark:text-white' : 'text-zinc-400'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={icon} filled={isActive && icon === 'home'} className="h-6 w-6" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
