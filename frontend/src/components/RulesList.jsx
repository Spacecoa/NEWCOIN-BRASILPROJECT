/** Lista numerada das regras (cadastro, página de regras). */
export default function RulesList({ rules, compact = false }) {
  return (
    <ol className={compact ? 'space-y-2' : 'space-y-4'}>
      {rules.map((r) => (
        <li key={r.id} className="flex gap-3">
          <span className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-extrabold text-brand-700 dark:bg-zinc-900 dark:text-brand-500 ${compact ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm'}`}>
            {r.position}
          </span>
          <span className="min-w-0">
            <b className={compact ? 'text-sm' : ''}>{r.title}</b>
            {r.description && <span className={`block text-zinc-500 ${compact ? 'text-xs' : 'text-sm'}`}>{r.description}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
