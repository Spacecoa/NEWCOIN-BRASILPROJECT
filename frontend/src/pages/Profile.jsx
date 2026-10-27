import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Feed from '../components/Feed.jsx';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

const TABS = [
  ['posts', 'Posts', '?exclude=replies'],
  ['replies', 'Posts e respostas', ''],
];

export default function Profile() {
  const { username } = useParams();
  const { user: me, logout } = useAuth();
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
      <PageHeader back={!isMe} title={profile.display_name} subtitle={`${m.post_count} posts`}>
        {isMe && (
          <Link to="/carteira" aria-label="Carteira" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-900">
            <Icon name="wallet" />
          </Link>
        )}
        {isMe && (
          <button onClick={logout} aria-label="Sair" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-900">
            <Icon name="logout" />
          </button>
        )}
      </PageHeader>
      <div className="px-4 pb-4">
        <div className="flex items-start justify-between">
          <Avatar user={profile} size="lg" />
          {!isMe && (
            <button
              onClick={toggleFollow}
              className={`min-h-11 rounded-full px-5 font-extrabold ${
                profile.relationship.following
                  ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                  : 'bg-brand-600 text-white'
              }`}
            >
              {profile.relationship.following ? 'Seguindo' : 'Seguir'}
            </button>
          )}
        </div>
        <h2 className="mt-3 text-xl font-bold">{profile.display_name}</h2>
        <p className="text-zinc-500">
          @{profile.username}
          {profile.relationship?.followed_by && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-900">Segue você</span>}
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
      <div role="tablist" className="flex gap-2 px-4 pb-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-10 rounded-full px-4 text-sm ${tab === key ? 'bg-zinc-900 font-extrabold text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Feed endpoint={`/api/users/${username}/posts${suffix}`} emptyText="Sem posts ainda." />
    </>
  );
}
