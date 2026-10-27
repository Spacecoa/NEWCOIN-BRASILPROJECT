import { useNavigate } from 'react-router';
import Icon from './Icon.jsx';

export default function PageHeader({ title, subtitle, back = false, children }) {
  const navigate = useNavigate();
  return (
    <header
      className="sticky z-10 bg-white/90 px-4 pb-3 pt-3 backdrop-blur dark:bg-[#0b0d0c]/90"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex min-h-11 items-center gap-2">
        {back && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Voltar"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <Icon name="back" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-zinc-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </header>
  );
}
