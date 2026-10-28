import { useState } from 'react';
import { Link } from 'react-router';

const input =
  'w-full min-h-12 rounded-2xl bg-zinc-50 px-4 text-base outline-none focus:ring-2 focus:ring-brand-500/40 dark:bg-zinc-900';

export function Field({ label, ...props }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-600 dark:text-zinc-400">{label}</span>
      <input className={input} {...props} />
    </label>
  );
}

/** Senha com botão de mostrar/ocultar (útil no celular, onde é fácil errar uma letra). */
export function PasswordField({ label, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="relative block">
        <input className={`${input} pr-24`} type={show ? 'text' : 'password'} {...props} />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-pressed={show}
          className="absolute inset-y-0 right-1 my-1 rounded-full px-4 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </span>
    </label>
  );
}

export default function AuthForm({ title, submitLabel, onSubmit, footer, notice, children }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function handle(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (err) {
      setError(err.details?.map((d) => `${d.path}: ${d.message}`).join(' · ') || err.message);
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={handle} className="w-full max-w-sm space-y-4">
        <p className="text-3xl font-extrabold tracking-tight text-brand-600">ágora</p>
        <h1 className="text-xl font-bold">{title}</h1>
        {notice && !error && <p role="status" className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-zinc-900 dark:text-brand-500">{notice}</p>}
        {children}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button disabled={busy} className="min-h-12 w-full rounded-full bg-brand-600 font-extrabold text-white hover:bg-brand-700 disabled:opacity-50">
          {submitLabel}
        </button>
        <p className="text-sm text-zinc-500">{footer}</p>
        <p className="text-xs text-zinc-400">Protótipo de pesquisa — uso local, não comercial.</p>
      </form>
    </div>
  );
}

export { Link };
