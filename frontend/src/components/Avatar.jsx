const COLORS = ['bg-emerald-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-teal-600', 'bg-orange-600'];

function colorFor(seed = '') {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export default function Avatar({ user, size = 'md' }) {
  const dims = size === 'lg' ? 'h-16 w-16 text-2xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  const initials = (user?.display_name ?? user?.username ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <div aria-hidden className={`${dims} ${colorFor(user?.username)} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}>
      {initials}
    </div>
  );
}
