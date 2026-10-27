import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Avatar from '../components/Avatar.jsx';
import Feed from '../components/Feed.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

export default function Explore() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => {
      api(`/api/users?q=${encodeURIComponent(q.trim())}`).then((r) => setResults(r.data)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <PageHeader title="Explorar" subtitle="Timeline pública desta instância" />
      <div className="px-4 pb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar pessoas"
          aria-label="Buscar pessoas"
          className="min-h-11 w-full rounded-full bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
        />
        {results.length > 0 && (
          <ul className="mt-2">
            {results.map((u) => (
              <li key={u.id}>
                <Link to={`/u/${u.username}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <Avatar user={u} size="sm" />
                  <span className="font-semibold">{u.display_name}</span>
                  <span className="text-sm text-zinc-500">@{u.username}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Feed endpoint="/api/posts" />
    </>
  );
}
