import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { learnLocal } from '../lib/deviceAlgo.js';

const LABELS = {
  interesse: 'Seus interesses',
  pessoas: 'Pessoas',
  recencia: 'Recência',
  descoberta: 'Descoberta',
  popularidade: 'Popularidade',
};

/**
 * "Por que este post?": mostra a conta exata que colocou o post nesta posição
 * e deixa o usuário corrigir o algoritmo com "Mais disto" / "Menos disto".
 */
export default function WhyPanel({ post, onHide, authorUsername }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(null);
  const { ranking } = post;

  async function feedback(kind) {
    // O algoritmo fica só neste aparelho: o sinal fica no navegador e o servidor não fica sabendo.
    learnLocal(user?.id, post, kind, authorUsername);
    setSent(kind);
    if (kind === 'less') onHide?.(post.id);
  }

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="-ml-2 min-h-9 rounded-full px-2 text-xs font-semibold text-zinc-500 hover:text-brand-600"
      >
        {open ? 'Ocultar explicação' : `Por que este post? · nº ${ranking.position}${ranking.local ? ' · calculado neste aparelho' : ''}`}
      </button>
      {open && (
        <div className="mt-1 rounded-2xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900" role="region" aria-label="Explicação do ranking">
          <p className="mb-2 text-xs text-zinc-500">
            Pontuação {Math.round(ranking.score * 100)} de 100
            {ranking.topics.length > 0 && <> · tópicos: {ranking.topics.map((t) => t.label).join(', ')}</>}
          </p>
          <ul className="space-y-2">
            {ranking.reasons.map((r) => (
              <li key={r.fator}>
                <div className="flex justify-between gap-2 text-xs">
                  <span className="font-semibold">{LABELS[r.fator] ?? r.fator}</span>
                  <span className="tabular-nums text-zinc-500">+{Math.round(r.contribuicao * 100)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round(r.contribuicao * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{r.detalhe}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {sent ? (
              <p className="text-xs font-semibold text-brand-600">
                {sent === 'more' ? 'Anotado: mais posts assim.' : 'Anotado: menos posts assim.'}
              </p>
            ) : (
              <>
                <button type="button" onClick={() => feedback('more')} className="min-h-9 rounded-full bg-white px-3 text-xs font-extrabold dark:bg-zinc-800">
                  Mais disto
                </button>
                <button type="button" onClick={() => feedback('less')} className="min-h-9 rounded-full bg-white px-3 text-xs font-extrabold dark:bg-zinc-800">
                  Menos disto
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
