import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const env = process.env;

// Valores que já apareceram em exemplos e documentação: qualquer pessoa os conhece.
const KNOWN_SECRETS = new Set([
  'dev-only-secret',
  'troque-este-segredo-em-qualquer-ambiente-compartilhado',
  'changeme',
  'secret',
  'test-secret',
]);
export const MIN_SECRET_LENGTH = 32;

/**
 * Segredo que assina os tokens de acesso. Quem tem o segredo consegue "entrar" como
 * qualquer pessoa, então: segredo conhecido ou curto impede o servidor de iniciar.
 * Sem segredo nenhum, fora de produção, geramos um aleatório a cada início
 * (as sessões continuam valendo, porque a renovação não depende dele).
 */
export function resolveJwtSecret(value, nodeEnv) {
  if (!value) {
    if (nodeEnv === 'production') throw new Error('JWT_SECRET é obrigatório em produção. Gere um com: openssl rand -hex 32');
    if (nodeEnv !== 'test') console.warn('[config] JWT_SECRET vazio: usando um segredo aleatório só para esta execução.');
    return randomBytes(32).toString('hex');
  }
  if (KNOWN_SECRETS.has(value) || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET fraco ou conhecido. Use pelo menos ${MIN_SECRET_LENGTH} caracteres aleatórios (openssl rand -hex 32) ou deixe vazio em desenvolvimento.`,
    );
  }
  return value;
}

const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

/**
 * Em quem confiar para ler o IP real (X-Forwarded-For). "true" confia em QUALQUER um:
 * quem forja o cabeçalho ganha um limite de tentativas novo a cada pedido (docs/14, A-1).
 * Fora de produção, "true" impede o servidor de iniciar; em produção só gera um aviso,
 * para não mudar o comportamento de uma instalação que já esteja no ar.
 */
export function trustProxy(v, nodeEnv = env.NODE_ENV) {
  if (v === undefined || v === '' || v === 'false') return false;
  if (v === 'true') {
    const msg =
      'TRUST_PROXY=true confia em qualquer X-Forwarded-For e anula os limites por IP. Use o número de proxies (ex.: TRUST_PROXY=1) ou a lista de IPs deles.';
    if (nodeEnv !== 'production') throw new Error(msg);
    console.warn(`[config] ${msg}`);
    return true;
  }
  return /^\d+$/.test(v) ? Number(v) : v; // número de saltos ou lista de IPs/sub-redes
}

export const config = {
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://social:social@localhost:5432/social',
  redisUrl: env.REDIS_URL || null,
  jwtSecret: resolveJwtSecret(env.JWT_SECRET, env.NODE_ENV),
  // Token de acesso curto; a sessão continua por renovação (refresh) guardada no servidor.
  accessTokenTtlSec: num(env.ACCESS_TOKEN_TTL_SEC, 15 * 60),
  sessionTtlDays: num(env.SESSION_TTL_DAYS, 30),
  // Cookie "Secure" só funciona em HTTPS; ligue fora de localhost.
  cookieSecure: env.COOKIE_SECURE === 'true',
  // Atrás de um proxy reverso, diga quantos saltos confiar para ler o IP real (X-Forwarded-For).
  trustProxy: trustProxy(env.TRUST_PROXY),
  // Limite geral da API, por pessoa logada (ou por IP sem login).
  apiRateLimit: num(env.API_RATE_LIMIT, 600),
  apiRateWindowSec: num(env.API_RATE_WINDOW_SEC, 5 * 60),
  // Banco: nenhuma consulta pode prender uma conexão por muito tempo.
  dbPoolMax: num(env.DB_POOL_MAX, 10),
  dbStatementTimeoutMs: num(env.DB_STATEMENT_TIMEOUT_MS, 5000),
  instanceDomain: env.INSTANCE_DOMAIN ?? 'localhost:4000',
  workerId: Number(env.WORKER_ID ?? 1),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  // Endereço do app no navegador, usado nos links enviados por e-mail (recuperar senha).
  webUrl: (env.WEB_URL ?? env.CORS_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
  // Como os e-mails saem. "log" (único disponível no protótipo) escreve o e-mail no log do
  // servidor, para testar localmente sem servidor de e-mail.
  mailTransport: env.MAIL_TRANSPORT ?? 'log',
  // Tamanho máximo da timeline materializada no Redis. O X documenta que a home
  // timeline retorna no máximo ~800 posts; usamos o mesmo teto.
  // Fuso que define o "dia" das missões diárias.
  tokenName: env.TOKEN_NAME ?? 'NewCoin',
  tokenSymbol: env.TOKEN_SYMBOL ?? 'NWC',
  missionTimezone: env.MISSION_TZ ?? 'America/Sao_Paulo',
  // Painel coletivo das missões: igual para todos, recalculado no máximo a cada N segundos.
  collectiveCacheSec: num(env.MISSIONS_COLLECTIVE_CACHE_SEC, 60),
  timelineCacheSize: Number(env.TIMELINE_CACHE_SIZE ?? 800),
  // GET /api/metricas só existe com este token (e exige o mesmo token no cabeçalho).
  metricsToken: env.METRICS_TOKEN || null,
  // Distribuir posts para os seguidores por fila no Redis (1) ou dentro do pedido (0).
  fanoutQueue: env.FANOUT_QUEUE !== '0',
  // Contas que moderam a instância (usernames separados por vírgula), promovidas ao iniciar.
  // Coleta automática das fontes oficiais da aba "Brasil em dados" (minutos). Desligada por
  // padrão: a aba usa o registro conferido à mão (src/official/registro.js).
  officialDataRefreshMin: num(env.OFFICIAL_DATA_REFRESH_MIN, 0),
  moderators: (env.MODERATORS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
