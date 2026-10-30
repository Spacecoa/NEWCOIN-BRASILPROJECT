import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fullDate } from '../lib/time.js';

/** Versões de um post editado, da atual para a primeira. Aberto a quem pode ler o post. */
export default function EditHistory({ postId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api(`/api/posts/${postId}/edicoes`).then((r) => setData(r.data)).catch((e) => setError(e.message));
  }, [postId]);
  if (error) return <p className="mt-2 text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="mt-2 text-sm text-zinc-400">Carregando o histórico…</p>;
  const versions = [
    { version: data.current.version, text: data.current.text, label: `Atual, desde ${fullDate(data.current.since)}` },
    ...[...data.previous].reverse().map((v) => ({ version: v.version, text: v.text, label: `Versão ${v.version}, até ${fullDate(v.until)}` })),
  ];
  return (
    <section aria-label="Histórico de edições" className="mt-2 rounded-2xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-extrabold">Histórico de edições</h3>
      <ol className="mt-1 space-y-2">
        {versions.map((v) => (
          <li key={v.version}>
            <p className="text-xs text-zinc-500">{v.label}</p>
            <p className="whitespace-pre-wrap">{v.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
