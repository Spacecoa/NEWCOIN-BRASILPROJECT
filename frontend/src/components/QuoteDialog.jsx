import { useEffect } from 'react';
import Composer from './Composer.jsx';
import Icon from './Icon.jsx';

/** Janela para citar um post: o texto novo em cima e o post citado embaixo. */
export default function QuoteDialog({ post, author, onClose, onPosted }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Citar post" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="pb-safe relative w-full max-w-lg rounded-t-3xl bg-white px-4 pt-3 md:rounded-3xl dark:bg-zinc-950">
        <div className="mb-1 flex items-center gap-2">
          <button type="button" onClick={onClose} aria-label="Cancelar" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full">
            <Icon name="close" />
          </button>
          <h2 className="font-extrabold">Citar post</h2>
        </div>
        <div className="pb-4">
          <Composer bare autoFocus id="composer-quote" placeholder="O que você quer dizer sobre isso?" quoteOf={post} quoteAuthor={author} onPosted={onPosted} />
        </div>
      </div>
    </div>
  );
}
