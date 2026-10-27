import { useState } from 'react';
import { Link } from 'react-router';

const input =
  'w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-brand-500 dark:border-zinc-700';

export function Field({ label, ...props }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-600 dark:text-zinc-400">{label}</span>
      <input className={input} {...props} />
    </label>
  );
}

export default function AuthForm({ title, submitLabel, onSubmit, footer, children }) {
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handle} className="w-full max-w-sm space-y-4">
        <p className="text-3xl font-black text-brand-600">Ágora</p>
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button disabled={busy} className="w-full rounded-full bg-brand-600 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {submitLabel}
        </button>
        <p className="text-sm text-zinc-500">{footer}</p>
        <p className="text-xs text-zinc-400">Protótipo de pesquisa — uso local, não comercial.</p>
      </form>
    </div>
  );
}

export { Link };
