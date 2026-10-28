/** Linha simples do histórico, com o último ponto destacado. Sem eixos: o número grande é o que importa. */
export default function Sparkline({ points, label }) {
  if (!points || points.length < 2) return null;
  const w = 240;
  const h = 48;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (w - 8) + 4, h - 6 - ((p.value - min) / span) * (h - 12)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = xy.at(-1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full text-brand-600" role="img" aria-label={label}>
      <path d={`${d} L${lx},${h} L4,${h} Z`} fill="currentColor" opacity="0.08" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3.5" fill="currentColor" />
    </svg>
  );
}
