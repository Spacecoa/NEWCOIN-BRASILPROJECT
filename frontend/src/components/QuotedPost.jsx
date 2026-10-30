import { useNavigate } from 'react-router';
import { relativeTime } from '../lib/time.js';
import Avatar from './Avatar.jsx';

/**
 * Post citado, dentro de outro. Se o original foi apagado, removido ou é de alguém com quem
 * a pessoa tem bloqueio, a API não o entrega e aqui aparece só um aviso.
 */
export default function QuotedPost({ post, author, link = true }) {
  const navigate = useNavigate();
  if (!post || !author) {
    return <p className="mt-2 rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800">Este post não está disponível.</p>;
  }
  const open = (e) => {
    e.stopPropagation();
    if (link) navigate(`/post/${post.id}`);
  };
  const Tag = link ? 'button' : 'div';
  return (
    <Tag
      {...(link ? { type: 'button', onClick: open, 'aria-label': `Post citado de ${author.display_name}: ${post.text}` } : {})}
      className="mt-2 block w-full rounded-2xl border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60"
    >
      <span className="flex items-center gap-1.5 text-sm">
        <Avatar user={author} size="sm" />
        <b className="truncate">{author.display_name}</b>
        <span className="truncate text-zinc-400">@{author.username} · {relativeTime(post.created_at)}</span>
      </span>
      <span className="mt-1 line-clamp-4 text-[15px]">{post.text}</span>
      {post.media?.length > 0 && (
        <img src={post.media[0].url} alt={post.media[0].alt} loading="lazy" className="mt-2 max-h-40 w-full rounded-xl object-cover" />
      )}
    </Tag>
  );
}
