import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { ACCEPTED, prepareImage } from '../lib/imageResize.js';
import Icon from './Icon.jsx';

export const MAX_LENGTH = 280;
export const MAX_IMAGES = 4;

/**
 * Caixa de criação de post. Com `replyTo`, cria uma resposta (thread).
 * Aceita até 4 imagens, cada uma com descrição obrigatória (lida por leitores de tela).
 * Chama onPosted({ data, includes }) com o post criado.
 */
export default function Composer({ replyTo = null, onPosted, placeholder = 'O que está acontecendo?', autoFocus = false, bare = false, id }) {
  const fieldId = id ?? (replyTo ? `reply-${replyTo}` : 'composer');
  const [text, setText] = useState('');
  const [images, setImages] = useState([]); // { key, blob, url, alt }
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef(null);
  const remaining = MAX_LENGTH - text.length;
  const missingAlt = images.some((img) => !img.alt.trim());
  const disabled = sending || !text.trim() || remaining < 0 || missingAlt;

  // Libera a memória das prévias quando a caixa some.
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function addFiles(files) {
    setError(null);
    const room = MAX_IMAGES - images.length;
    const picked = [...files].slice(0, room);
    if (files.length > room) setError(`No máximo ${MAX_IMAGES} imagens por post.`);
    for (const file of picked) {
      try {
        const { blob } = await prepareImage(file);
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        setImages((prev) => [...prev, { key: url, blob, url, alt: '' }]);
      } catch (err) {
        setError(err.message);
      }
    }
  }

  const removeImage = (key) => setImages((prev) => prev.filter((img) => img.key !== key));
  const setAlt = (key, alt) => setImages((prev) => prev.map((img) => (img.key === key ? { ...img, alt } : img)));

  async function submit(e) {
    e.preventDefault();
    if (disabled) return;
    setSending(true);
    setError(null);
    try {
      const media = [];
      for (const img of images) {
        const { data } = await api('/api/midia', { method: 'POST', body: img.blob });
        media.push({ id: data.id, alt: img.alt.trim() });
      }
      const result = await api('/api/posts', { method: 'POST', body: { text, reply_to_id: replyTo, ...(media.length ? { media } : {}) } });
      setText('');
      setImages([]);
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
      {images.length > 0 && (
        <ul className="mt-2 grid gap-3" aria-label="Imagens do post">
          {images.map((img, i) => (
            <li key={img.key} className="flex gap-3">
              <img src={img.url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <label htmlFor={`${fieldId}-alt-${i}`} className="text-sm font-semibold">
                  Descrição da imagem {i + 1} <span className="font-normal text-zinc-500">(obrigatória)</span>
                </label>
                <textarea
                  id={`${fieldId}-alt-${i}`}
                  value={img.alt}
                  onChange={(e) => setAlt(img.key, e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="O que aparece na imagem, para quem não enxerga"
                  className="mt-1 w-full resize-none rounded-xl bg-zinc-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900"
                />
                <button type="button" onClick={() => removeImage(img.key)} className="-ml-2 min-h-11 rounded-full px-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                  Tirar imagem {i + 1}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-end gap-3">
        {images.length < MAX_IMAGES && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(',')}
              multiple
              hidden
              aria-label="Escolher imagens"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Adicionar imagem"
              className="mr-auto flex h-11 w-11 items-center justify-center rounded-full text-brand-600 hover:bg-brand-50 dark:hover:bg-zinc-900"
            >
              <Icon name="image" />
            </button>
          </>
        )}
        {error && <span role="alert" className="mr-auto text-sm text-rose-600">{error}</span>}
        {missingAlt && !error && <span className="mr-auto text-sm text-zinc-500">Descreva cada imagem para postar.</span>}
        <span className={`text-sm tabular-nums ${remaining < 0 ? 'text-rose-600' : remaining < 20 ? 'text-amber-600' : 'text-zinc-400'}`}>
          {remaining}
        </span>
        <button
          type="submit"
          disabled={disabled}
          className="min-h-11 rounded-full bg-brand-600 px-5 font-extrabold text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {sending && images.length ? 'Enviando…' : replyTo ? 'Responder' : 'Postar'}
        </button>
      </div>
    </form>
  );
}
