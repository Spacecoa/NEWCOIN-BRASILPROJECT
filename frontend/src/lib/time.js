// Timestamp relativo compacto no estilo do X ("agora", "5 min", "3 h", "12 de out.").
export function relativeTime(date, now = new Date()) {
  const d = new Date(date);
  const sec = Math.round((now - d) / 1000);
  if (sec < 45) return 'agora';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export const fullDate = (date) =>
  new Date(date).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
