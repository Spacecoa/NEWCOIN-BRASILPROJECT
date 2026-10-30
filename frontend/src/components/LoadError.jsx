/** Erro ao carregar uma tela, sempre com um jeito de tentar de novo (sem rede, servidor fora…). */
export default function LoadError({ message, onRetry, className = 'p-8' }) {
  return (
    <div role="alert" className={`${className} text-center text-zinc-500`}>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-full bg-zinc-100 px-5 font-extrabold text-zinc-900 dark:bg-zinc-900 dark:text-white">
          Tentar de novo
        </button>
      )}
    </div>
  );
}
