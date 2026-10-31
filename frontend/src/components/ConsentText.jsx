/** O texto do termo de consentimento, em seções curtas. */
export default function ConsentText({ term, compact = false }) {
  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      <p className={compact ? '' : 'text-base'}>{term.summary}</p>
      {term.sections.map((s) => (
        <section key={s.title}>
          <h3 className="font-extrabold">{s.title}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
            {s.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-zinc-500">Versão do termo: {term.version}</p>
    </div>
  );
}
