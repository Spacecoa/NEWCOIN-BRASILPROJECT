import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Feed from '../components/Feed.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

const TABS = [
  ['posts', 'Posts', '?exclude=replies'],
  ['replies', 'Posts e respostas', ''],
];

export default function Profile() {
  const { username } = useParams();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('posts');

  useEffect(() => {
    setProfile(null);
    setError(null);
    api(`/api/users/${username}`).then((r) => setProfile(r.data)).catch((e) => setError(e.message));
  }, [username]);

  async function toggleFollow() {
    const following = profile.relationship.following;
    await api(`/api/users/${username}/follow`, { method: following ? 'DELETE' : 'POST' });
    setProfile((p) => ({
      ...p,
      relationship: { ...p.relationship, following: !following },
      public_metrics: { ...p.public_metrics, followers_count: p.public_metrics.followers_count + (following ? -1 : 1) },
    }));
  }

  if (error) return <p className="p-8 text-center text-zinc-500">{error}</p>;
  if (!profile) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const isMe = me.id === profile.id;
  const m = profile.public_metrics;
  const suffix = TABS.find(([k]) => k === tab)[2];

  return (
    <>
      <PageHeader title={profile.display_name} subtitle={`${m.post_count} posts`} />
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-start justify-between">
          <Avatar user={profile} size="lg" />
          {!isMe && (
            <button
              onClick={toggleFollow}
              className={`rounded-full px-4 py-1.5 font-semibold ${
                profile.relationship.following
                  ? 'border border-zinc-300 hover:border-rose-300 hover:text-rose-600 dark:border-zinc-700'
                  : 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
              }`}
            >
              {profile.relationship.following ? 'Seguindo' : 'Seguir'}
            </button>
          )}
        </div>
        <h2 className="mt-3 text-xl font-bold">{profile.display_name}</h2>
        <p className="text-zinc-500">
          @{profile.username}
          {profile.relationship?.followed_by && <span className="ml-2 rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">Segue você</span>}
        </p>
        <p className="text-xs text-zinc-400" title="Handle federado (WebFinger)">{profile.handle}</p>
        {profile.bio && <p className="mt-2">{profile.bio}</p>}
        <p className="mt-2 text-sm text-zinc-500">
          Entrou em {new Date(profile.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </p>
        <p className="mt-2 flex gap-4 text-sm">
          <span><b>{m.following_count}</b> <span className="text-zinc-500">Seguindo</span></span>
          <span><b>{m.followers_count}</b> <span className="text-zinc-500">Seguidores</span></span>
        </p>
      </div>
      <div role="tablist" className="flex border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 ${tab === key ? 'border-b-2 border-brand-600 font-semibold' : 'text-zinc-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Feed endpoint={`/api/users/${username}/posts${suffix}`} emptyText="Sem posts ainda." />
    </>
  );
}
