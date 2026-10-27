// Avatares em tons suaves (fundo claro + inicial escura), para não competir com o conteúdo.
const TONES = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
];

function toneFor(seed = '') {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export default function Avatar({ user, size = 'md' }) {
  const dims = size === 'lg' ? 'h-16 w-16 text-2xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  const initials = (user?.display_name ?? user?.username ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <div aria-hidden className={`${dims} ${toneFor(user?.username)} flex shrink-0 items-center justify-center rounded-full font-extrabold`}>
      {initials}
    </div>
  );
}
