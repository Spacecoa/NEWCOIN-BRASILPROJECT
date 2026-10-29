/** Mês absoluto de um período ('AAAAMM' ou 'AAAATn'), para espaçar os pontos pelo tempo real. */
function monthIndex(period) {
  const y = Number(period.slice(0, 4));
  return period.includes('T') ? y * 12 + Number(period.slice(5)) * 3 : y * 12 + Number(period.slice(4, 6));
}

/**
 * Linha simples do histórico, com o último ponto destacado. Sem eixos: o número grande é o
 * que importa. Os pontos ficam na posição do tempo (um ponto por ano no começo e meses
 * seguidos no fim não parecem igualmente espaçados).
 */
export default function Sparkline({ points, label }) {
  if (!points || points.length < 2) return null;
  const w = 240;
  const h = 48;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const t = points.map((p) => monthIndex(p.period));
  const t0 = t[0];
  const tspan = t.at(-1) - t0 || 1;
  const xy = points.map((p, i) => [((t[i] - t0) / tspan) * (w - 8) + 4, h - 6 - ((p.value - min) / span) * (h - 12)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = xy.at(-1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full text-brand-600" role="img" aria-label={label}>
      <path d={`${d} L${lx},${h} L4,${h} Z`} fill="currentColor" opacity="0.08" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {xy.slice(0, -1).map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="currentColor" opacity="0.6" />
      ))}
      <circle cx={lx} cy={ly} r="3.5" fill="currentColor" />
    </svg>
  );
}
