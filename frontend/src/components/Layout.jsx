import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';

// Mobile first: no celular, barra de abas fixa no rodapé (zona do polegar).
// A partir de md, a mesma navegação vira coluna lateral.
export default function Layout() {
  const { user, logout } = useAuth();
  const items = [
    ['/', 'home', 'Início'],
    ['/explorar', 'search', 'Explorar'],
    ['/mencoes', 'at', 'Menções'],
    ['/canais', 'channels', 'Canais'],
    [`/u/${user.username}`, 'user', 'Perfil'],
  ];
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl">
      <nav aria-label="Principal" className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 px-3 py-6 md:flex">
        <p className="mb-6 px-3 text-2xl font-extrabold tracking-tight text-brand-600">ágora</p>
        {[...items.slice(0, 4), ['/missoes', 'sprout', 'Missões'], items[4]].map(([to, icon, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-full px-3 text-base transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                isActive ? 'font-extrabold text-zinc-900 dark:text-white' : 'text-zinc-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon name={icon} filled={isActive && icon !== 'search' && icon !== 'at'} className="h-6 w-6" />
                {label}
              </>
            )}
          </NavLink>
        ))}
        <div className="mt-auto flex items-center gap-2 px-2">
          <Avatar user={user} size="sm" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-semibold">{user.display_name}</p>
            <p className="truncate text-zinc-500">@{user.username}</p>
          </div>
          <button
            onClick={logout}
            aria-label="Sair"
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <Icon name="logout" />
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 pb-24 md:border-x md:border-zinc-100 md:pb-0 md:dark:border-zinc-900">
        <Outlet />
      </main>

      <nav
        aria-label="Principal (celular)"
        className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-zinc-100 bg-white/95 backdrop-blur md:hidden dark:border-zinc-900 dark:bg-[#0b0d0c]/95"
      >
        <div className="flex justify-around px-2">
          {items.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  isActive ? 'font-extrabold text-zinc-900 dark:text-white' : 'text-zinc-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={icon} filled={isActive && icon !== 'search' && icon !== 'at'} className="h-6 w-6" />
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
