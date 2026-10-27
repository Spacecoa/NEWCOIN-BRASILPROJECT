export default function PageHeader({ title, subtitle, children }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{title}</h1>
          {subtitle && <p className="truncate text-sm text-zinc-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </header>
  );
}
