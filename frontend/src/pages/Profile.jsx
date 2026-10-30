import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLoginRedirect } from '../lib/useLoginRedirect.js';
import Avatar from '../components/Avatar.jsx';
import Feed from '../components/Feed.jsx';
import Icon from '../components/Icon.jsx';
import LoadError from '../components/LoadError.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { block, mute } from '../lib/moderation.js';
import PostMenu from '../components/PostMenu.jsx';
import ReportDialog from '../components/ReportDialog.jsx';

const TABS = [
  ['posts', 'Posts', '?exclude=replies'],
  ['replies', 'Posts e respostas', ''],
];

export default function Profile() {
  const { username } = useParams();
  const { user: me, logout, logoutEverywhere } = useAuth();
  const toLogin = useLoginRedirect();
  const [confirmAll, setConfirmAll] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [version, setVersion] = useState(0); // recarrega os posts depois de bloquear/desbloquear
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('posts');

  const load = () => api(`/api/users/${username}`).then((r) => setProfile(r.data));
  useEffect(() => {
    setProfile(null);
    setError(null);
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function toggleMute() {
    await mute(username, !profile.relationship.muting);
    await load();
  }
  async function toggleBlock() {
    await block(username, !profile.relationship.blocking);
    await load();
    setVersion((v) => v + 1);
  }

  async function toggleFollow() {
    if (!me) return toLogin(); // visitante: ler pode, seguir pede login
    const following = profile.relationship.following;
    await api(`/api/users/${username}/follow`, { method: following ? 'DELETE' : 'POST' });
    setProfile((p) => ({
      ...p,
      relationship: { ...p.relationship, following: !following },
      public_metrics: { ...p.public_metrics, followers_count: p.public_metrics.followers_count + (following ? -1 : 1) },
    }));
  }

  if (error) return <LoadError message={error} onRetry={() => { setError(null); load().catch((e) => setError(e.message)); }} />;
  if (!profile) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const isMe = me?.id === profile.id;
  const m = profile.public_metrics;
  const rel = profile.relationship ?? {};
  const cutOff = rel.blocking || rel.blocked_by;
  const suffix = TABS.find(([k]) => k === tab)[2];

  return (
    <>
      <PageHeader back={!isMe} title={profile.display_name} subtitle={`${m.post_count} ${m.post_count === 1 ? 'post' : 'posts'}`}>
        {isMe && (
          <Link to="/carteira" aria-label="Carteira" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-900">
            <Icon name="wallet" />
          </Link>
        )}
        {me && !isMe && (
          <PostMenu
            large
            username={profile.username}
            muting={rel.muting}
            blocking={rel.blocking}
            reportLabel={`Denunciar @${profile.username}`}
            onMute={toggleMute}
            onBlock={toggleBlock}
            onReport={() => setReporting(true)}
          />
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
          {!isMe && !cutOff && (
            <button
              onClick={toggleFollow}
              className={`min-h-11 rounded-full px-5 font-extrabold ${
                rel.following
                  ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                  : 'bg-brand-600 text-white'
              }`}
            >
              {rel.following ? 'Seguindo' : 'Seguir'}
            </button>
          )}
        </div>
        <h2 className="mt-3 flex items-center gap-2 text-xl font-bold">
          {profile.display_name}
          {profile.is_moderator && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-extrabold text-brand-700 dark:bg-zinc-900 dark:text-brand-500">
              <Icon name="shield" className="h-3.5 w-3.5" /> Moderação
            </span>
          )}
        </h2>
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
        {rel.blocked_by && (
          <p role="status" className="mt-3 rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
            @{profile.username} bloqueou você. Vocês não veem os posts um do outro.
          </p>
        )}
        {rel.blocking && (
          <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
            <span>Você bloqueou @{profile.username}. Vocês não veem os posts um do outro.</span>
            <button type="button" onClick={toggleBlock} className="min-h-11 shrink-0 rounded-full px-4 font-extrabold text-brand-600">Desbloquear</button>
          </div>
        )}
        {rel.muting && !rel.blocking && (
          <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
            <span>Você silenciou @{profile.username}. Os posts dessa conta não aparecem nos seus feeds.</span>
            <button type="button" onClick={toggleMute} className="min-h-11 shrink-0 rounded-full px-4 font-extrabold text-brand-600">Desfazer</button>
          </div>
        )}
        {isMe && (
          <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Sua conta">
            <Link to="/privacidade" className="flex min-h-11 items-center gap-2 rounded-full bg-zinc-50 px-4 hover:bg-zinc-100 dark:bg-zinc-900">
              <Icon name="block" className="h-4 w-4" /> Bloqueios e denúncias
            </Link>
            <Link to="/regras" className="flex min-h-11 items-center gap-2 rounded-full bg-zinc-50 px-4 hover:bg-zinc-100 dark:bg-zinc-900">
              <Icon name="book" className="h-4 w-4" /> Regras da instância
            </Link>
            {me.is_moderator && (
              <Link to="/moderacao" className="flex min-h-11 items-center gap-2 rounded-full bg-zinc-50 px-4 hover:bg-zinc-100 dark:bg-zinc-900">
                <Icon name="shield" className="h-4 w-4" /> Fila da moderação
              </Link>
            )}
          </nav>
        )}
        {isMe && !confirmAll && (
          <button type="button" onClick={() => setConfirmAll(true)} className="mt-3 min-h-11 text-sm text-zinc-500 underline-offset-4 hover:underline">
            Sair de todos os aparelhos
          </button>
        )}
        {isMe && confirmAll && (
          <div role="group" aria-label="Confirmar saída de todos os aparelhos" className="mt-3 rounded-2xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
            <p>Isso encerra sua sessão em todos os aparelhos, inclusive neste. Use se perdeu um celular ou entrou num computador que não é seu.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={logoutEverywhere} className="min-h-11 rounded-full bg-rose-600 px-5 font-extrabold text-white">
                Sair de todos
              </button>
              <button type="button" onClick={() => setConfirmAll(false)} className="min-h-11 rounded-full px-5 text-zinc-600 dark:text-zinc-300">
                Cancelar
              </button>
            </div>
          </div>
        )}
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
      {reporting && <ReportDialog username={profile.username} onClose={() => setReporting(false)} onBlocked={() => load().then(() => setVersion((v) => v + 1))} />}
      <Feed
        key={`${username}:${tab}:${version}`}
        endpoint={`/api/users/${username}/posts${suffix}`}
        emptyText={cutOff ? 'Os posts não aparecem por causa do bloqueio.' : 'Sem posts ainda.'}
      />
    </>
  );
}
