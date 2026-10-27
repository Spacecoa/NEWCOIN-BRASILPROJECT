import { useEffect } from 'react';
import Composer from './Composer.jsx';
import Icon from './Icon.jsx';

/** Folha que sobe do rodapé no celular, com o Composer dentro. */
export default function ComposeSheet({ open, onClose, onPosted }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label="Novo post">
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="pb-safe animate-sheet absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-4 pt-3 dark:bg-zinc-950">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={onClose} aria-label="Cancelar" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full">
            <Icon name="close" />
          </button>
          <span className="mx-auto h-1 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <span className="w-11" />
        </div>
        <div className="pb-4">
          <Composer
            bare
            autoFocus
            id="composer-sheet"
            onPosted={(result) => {
              onPosted(result);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
