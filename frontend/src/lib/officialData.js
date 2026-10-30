// Formatação e rótulos da aba "Brasil em dados".

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'AAAAMM' → 'set/2026' · 'AAAATn' → '3º tri/2026'. */
export function periodLabel(p) {
  if (!p) return '';
  if (p.includes('T')) return `${p.slice(5)}º tri/${p.slice(0, 4)}`;
  return `${MONTHS[Number(p.slice(4, 6)) - 1]}/${p.slice(0, 4)}`;
}

/** '2026-10-09' → '9 out 2026' · '2026-10' → 'out/2026' (datas do registro conferido). */
export function dateLabel(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return day ? `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}` : `${MONTHS[Number(m) - 1]}/${y}`;
}

export function formatValue(v, unit, decimals = 1) {
  if (v === null || v === undefined) return '—';
  const n = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
  if (unit === 'R$') return `R$ ${n}`;
  // "%" e "% ao ano" colam no número ("13,75% ao ano"), como nos outros indicadores.
  if (unit.startsWith('%')) return `${n}${unit}`;
  return `${n} ${unit}`;
}

/** Diferença em relação ao período anterior: em pontos percentuais para taxas, em % para valores. */
export function changeLabel(latest, previous, unit, decimals = 1) {
  if (!latest || !previous) return null;
  const fmt = (x) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: 'exceptZero' }).format(x);
  if (unit === 'R$') return `${fmt(((latest.value / previous.value) - 1) * 100)}% desde ${periodLabel(previous.period)}`;
  return `${fmt(latest.value - previous.value)} ponto${Math.abs(latest.value - previous.value) >= 2 ? 's' : ''} desde ${periodLabel(previous.period)}`;
}

export const BADGES = {
  confirmado: { label: 'Confirmado por 3 conferências', tone: 'ok', help: 'A origem respondeu, uma fonte independente concorda e a cópia confere.' },
  fonte_unica: { label: 'Fonte única, conferida', tone: 'info', help: 'Só uma instituição produz este dado. Conferimos a cópia, a data e o código.' },
  divergencia: { label: 'Fontes divergem', tone: 'warn', help: 'As fontes não concordam. Veja os valores lado a lado e o porquê.' },
  desatualizado: { label: 'Desatualizado', tone: 'warn', help: 'A fonte não publica dado novo há mais tempo que o esperado.' },
  parcial: { label: 'Conferência parcial', tone: 'info', help: 'A fonte independente ainda não respondeu.' },
  sem_dados: { label: 'Sem dados ainda', tone: 'muted', help: 'A origem ainda não foi lida. Veja o motivo em "De onde vem".' },
};

export const ROLE_LABEL = { origem: 'Origem (quem produz)', republicacao: 'Confere a cópia', independente: 'Fonte independente' };
