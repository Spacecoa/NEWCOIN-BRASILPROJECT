import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { fullDate, relativeTime } from '../lib/time.js';

const MISSION_LABEL = {
  curtir: 'Curta 5 posts',
  republicar: 'Republique 2 posts',
  comentar: 'Comente 3 posts',
  recompensar: 'Recompense alguém',
  tempo_no_app: '10 minutos ativo',
  apresentar: 'Apresente-se',
  boas_vindas: 'Dê boas-vindas',
  responder_pergunta: 'Responda quem perguntou',
  ponte: 'Construa uma ponte',
  amplificar: 'Amplifique uma voz pequena',
  conversa_coletiva: 'Conversa coletiva',
  organizar: 'Abra um espaço',
  convidar: 'Traga alguém de confiança',
};

function describe(entry) {
  switch (entry.kind) {
    case 'grant':
      return 'Saldo de boas-vindas';
    case 'mission':
      return `Missão: ${MISSION_LABEL[entry.mission] ?? entry.mission}`;
    case 'tip_sent':
      return `Você recompensou @${entry.counterpart ?? 'conta removida'}`;
    case 'tip_received':
      return `@${entry.counterpart ?? 'conta removida'} recompensou seu post`;
    default:
      return entry.kind;
  }
}

export default function Wallet() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/carteira').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="p-8 text-center text-zinc-500">{error}</p>;
  if (!data) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;
  const { token, balance, totals, ledger } = data;

  return (
    <>
      <PageHeader back title="Carteira" subtitle={`${token.name} (${token.symbol}), o token interno do Ágora`} />
      <section className="mx-4 rounded-3xl bg-brand-600 p-5 text-white">
        <p className="text-sm text-brand-100">Seu saldo</p>
        <p className="text-4xl font-extrabold tabular-nums">
          {balance} <span className="text-2xl">{token.symbol}</span>
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
          {[
            [totals.from_missions, 'de missões'],
            [totals.received, 'recebidos'],
            [totals.given, 'dados'],
          ].map(([n, label]) => (
            <p key={label} className="rounded-2xl bg-white/10 py-2">
              <span className="block text-lg font-extrabold tabular-nums">{n}</span>
              <span className="block text-xs text-brand-100">{label}</span>
            </p>
          ))}
        </div>
      </section>

      <section className="px-4 py-4 text-sm" aria-label="Como funciona">
        <h2 className="font-extrabold">Como funciona</h2>
        <ul className="mt-1 space-y-1 text-zinc-600 dark:text-zinc-300">
          <li>Você ganha {token.symbol} concluindo <Link to="/missoes" className="font-semibold text-brand-600">missões</Link>.</li>
          <li>Use para recompensar posts de outras pessoas: o botão <Icon name="coin" className="inline h-4 w-4" /> transfere {token.tip_amount} {token.symbol} seu para quem escreveu.</li>
          <li>Por enquanto, essa é a única utilidade. O {token.name} não é dinheiro nem criptomoeda, e não pode ser comprado, vendido ou sacado.</li>
        </ul>
      </section>

      <section className="px-4 pb-6" aria-label="Extrato">
        <h2 className="font-extrabold">Extrato</h2>
        <ul className="mt-2">
          {ledger.map((e) => (
            <li key={e.id} className="flex min-h-12 items-center gap-3 py-1">
              <span className="min-w-0 flex-1">
                {e.post_id ? (
                  <Link to={`/post/${e.post_id}`} className="block truncate hover:underline">{describe(e)}</Link>
                ) : (
                  <span className="block truncate">{describe(e)}</span>
                )}
                <time dateTime={e.created_at} title={fullDate(e.created_at)} className="text-xs text-zinc-400">
                  {relativeTime(e.created_at)}
                </time>
              </span>
              <span className={`font-extrabold tabular-nums ${e.amount > 0 ? 'text-brand-600' : 'text-zinc-500'}`}>
                {e.amount > 0 ? '+' : ''}
                {e.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
