import { useState } from 'react';
import { api } from '../lib/api.js';

export const MAX_LENGTH = 280;

/**
 * Caixa de criação de post. Com `replyTo`, cria uma resposta (thread).
 * Chama onPosted({ data, includes }) com o post criado.
 */
export default function Composer({ replyTo = null, onPosted, placeholder = 'O que está acontecendo?', autoFocus = false, bare = false, id }) {
  const fieldId = id ?? (replyTo ? `reply-${replyTo}` : 'composer');
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const remaining = MAX_LENGTH - text.length;
  const disabled = sending || !text.trim() || remaining < 0;

  async function submit(e) {
    e.preventDefault();
    if (disabled) return;
    setSending(true);
    setError(null);
    try {
      const result = await api('/api/posts', { method: 'POST', body: { text, reply_to_id: replyTo } });
      setText('');
      onPosted?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className={bare ? '' : 'px-4 pb-4 pt-1'}>
      <label className="sr-only" htmlFor={fieldId}>
        {replyTo ? 'Escreva sua resposta' : 'Novo post'}
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={3}
        className="w-full resize-none rounded-2xl bg-zinc-50 px-4 py-3 text-base outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        {error && <span role="alert" className="mr-auto text-sm text-rose-600">{error}</span>}
        <span className={`text-sm tabular-nums ${remaining < 0 ? 'text-rose-600' : remaining < 20 ? 'text-amber-600' : 'text-zinc-400'}`}>
          {remaining}
        </span>
        <button
          type="submit"
          disabled={disabled}
          className="min-h-11 rounded-full bg-brand-600 px-5 font-extrabold text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {replyTo ? 'Responder' : 'Postar'}
        </button>
      </div>
    </form>
  );
}
