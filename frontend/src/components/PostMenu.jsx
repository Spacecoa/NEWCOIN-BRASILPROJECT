import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Menu "Mais opções" de um post ou perfil de outra pessoa: silenciar, bloquear, denunciar.
 * Bloquear pede confirmação dentro do próprio menu (é a ação com mais efeito).
 * Com muting/blocking, as opções viram "Deixar de silenciar" e "Desbloquear".
 */
export default function PostMenu({ username, onMute, onBlock, onReport, muting = false, blocking = false, reportLabel = 'Denunciar post', large = false }) {
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e) => !box.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900';
  const run = (fn) => (e) => {
    e.stopPropagation();
    setOpen(false);
    setConfirmBlock(false);
    fn();
  };

  return (
    <div ref={box} className="relative ml-auto" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmBlock(false);
        }}
        className={`flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 ${large ? 'h-11 w-11' : '-mr-2 -mt-2 h-9 w-9'}`}
      >
        <Icon name="more" className={large ? 'h-6 w-6' : 'h-5 w-5'} />
      </button>
      {open && (
        <div role="menu" className={`absolute right-0 z-20 w-64 ${large ? 'top-12' : 'top-8'} rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-zinc-100 dark:bg-zinc-950 dark:ring-zinc-800`}>
          {!confirmBlock ? (
            <>
              <button role="menuitem" type="button" className={item} onClick={run(onMute)}>
                <Icon name="mute" className="h-5 w-5 text-zinc-500" /> {muting ? 'Deixar de silenciar' : 'Silenciar'} @{username}
              </button>
              <button
                role="menuitem"
                type="button"
                className={item}
                onClick={blocking ? run(onBlock) : (e) => { e.stopPropagation(); setConfirmBlock(true); }}
              >
                <Icon name="block" className="h-5 w-5 text-zinc-500" /> {blocking ? 'Desbloquear' : 'Bloquear'} @{username}
              </button>
              <button role="menuitem" type="button" className={`${item} text-rose-600`} onClick={run(onReport)}>
                <Icon name="flag" className="h-5 w-5" /> {reportLabel}
              </button>
            </>
          ) : (
            <div className="space-y-2 p-2 text-sm">
              <p>
                <b>Bloquear @{username}?</b> Vocês deixam de ver os posts um do outro, os follows entre vocês são desfeitos e ninguém consegue responder
                ou curtir o outro.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={run(onBlock)} className="min-h-10 rounded-full bg-rose-600 px-4 font-extrabold text-white">
                  Bloquear
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmBlock(false); }} className="min-h-10 rounded-full px-4 text-zinc-600 dark:text-zinc-300">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
