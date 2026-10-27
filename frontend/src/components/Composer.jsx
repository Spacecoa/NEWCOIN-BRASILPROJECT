import { useState } from 'react';
import { api } from '../lib/api.js';

export const MAX_LENGTH = 280;

/**
 * Caixa de criação de post. Com `replyTo`, cria uma resposta (thread).
 * Chama onPosted({ data, includes }) com o post criado.
 */
export default function Composer({ replyTo = null, onPosted, placeholder = 'O que está acontecendo?', autoFocus = false }) {
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
    <form onSubmit={submit} className="border-b border-zinc-200 p-4 dark:border-zinc-800">
      <label className="sr-only" htmlFor={replyTo ? `reply-${replyTo}` : 'composer'}>
        {replyTo ? 'Escreva sua resposta' : 'Novo post'}
      </label>
      <textarea
        id={replyTo ? `reply-${replyTo}` : 'composer'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={3}
        className="w-full resize-none bg-transparent text-lg outline-none placeholder:text-zinc-400"
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        {error && <span role="alert" className="mr-auto text-sm text-rose-600">{error}</span>}
        <span className={`text-sm tabular-nums ${remaining < 0 ? 'text-rose-600' : remaining < 20 ? 'text-amber-600' : 'text-zinc-400'}`}>
          {remaining}
        </span>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {replyTo ? 'Responder' : 'Postar'}
        </button>
      </div>
    </form>
  );
}
