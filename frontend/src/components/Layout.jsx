import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Avatar from './Avatar.jsx';

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-full px-4 py-2 text-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 ${isActive ? 'font-bold' : ''}`;

export default function Layout() {
  const { user, logout } = useAuth();
  const items = [
    ['/', '🏠', 'Seguindo'],
    ['/explorar', '🔎', 'Explorar'],
    ['/mencoes', '@', 'Menções'],
    ['/canais', '📣', 'Canais'],
    [`/u/${user.username}`, '👤', 'Perfil'],
  ];
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl">
      <nav aria-label="Principal" className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 p-4 sm:flex">
        <p className="mb-4 px-4 text-2xl font-black text-brand-600">Ágora</p>
        {items.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
            <span aria-hidden className="w-6 text-center">{icon}</span>
            {label}
          </NavLink>
        ))}
        <div className="mt-auto flex items-center gap-2 px-2">
          <Avatar user={user} size="sm" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-semibold">{user.display_name}</p>
            <p className="truncate text-zinc-500">@{user.username}</p>
          </div>
          <button onClick={logout} className="text-sm text-zinc-500 hover:underline">Sair</button>
        </div>
      </nav>
      <main className="min-w-0 flex-1 border-x border-zinc-200 pb-16 dark:border-zinc-800 sm:pb-0">
        <Outlet />
      </main>
      {/* Navegação inferior no celular */}
      <nav aria-label="Principal (móvel)" className="fixed inset-x-0 bottom-0 flex justify-around border-t border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-950 sm:hidden">
        {items.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `px-3 py-1 text-xl ${isActive ? '' : 'opacity-50'}`}>
            {icon}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
