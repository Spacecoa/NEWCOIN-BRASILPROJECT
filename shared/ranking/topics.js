// Taxonomia de tópicos do protótipo e extração por palavras-chave.
// Simples de propósito: qualquer pessoa consegue ler a lista e entender por que
// um post foi marcado com um tópico. Nada de modelo opaco.

export const TOPICS = {
  backend: { label: 'Backend e APIs', keywords: ['backend', 'api', 'endpoint', 'express', 'node', 'rest', 'http'] },
  bancos: { label: 'Bancos de dados', keywords: ['postgres', 'sql', 'banco de dados', 'redis', 'indice', 'transac', 'cache', 'lrange'] },
  distribuidos: { label: 'Sistemas distribuídos', keywords: ['distribuid', 'fan-out', 'fanout', 'consistencia', 'snowflake', 'escala', 'fila', 'kafka', 'cursor', 'paginac'] },
  redes: { label: 'Redes e protocolos', keywords: ['protocolo', 'p2p', 'mtproto', 'websocket', 'tcp', 'pts'] },
  federacao: { label: 'Federação', keywords: ['federa', 'webfinger', 'activitypub', 'mastodon', 'instancia', 'outbox', 'inbox'] },
  seguranca: { label: 'Segurança', keywords: ['seguranc', 'cripto', 'jwt', 'xss', 'senha', '2fa', 'autentica', 'rate limit'] },
  frontend: { label: 'Frontend e design', keywords: ['react', 'css', 'frontend', 'componente', 'interface', 'acessib', 'tailwind', 'intersectionobserver', 'rolagem', 'design'] },
  dados: { label: 'Dados e IA', keywords: ['ciencia de dados', 'cientista de dados', 'analise de dados', 'machine learning', 'aprendizado de maquina', 'modelo', 'estatistic', 'algoritmo'] },
  infra: { label: 'Infraestrutura', keywords: ['kubernetes', 'sre', 'infra', 'deploy', 'servidor', 'disco', 'metrica', 'latencia', 'alerta'] },
  ensino: { label: 'Ensino', keywords: ['aula', 'turma', 'professor', 'estud', 'slides', 'curso'] },
  cotidiano: { label: 'Cotidiano', keywords: ['cafe', 'bom dia', 'violao', 'ciclis', 'bicicleta'] },
};

export const TOPIC_IDS = Object.keys(TOPICS);

/** Minúsculas e sem acentos: "Consistência" → "consistencia". */
export function normalize(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Casa a palavra-chave no começo de uma palavra ("transac" casa "transação").
const matcher = (kw) => new RegExp(`(^|[^a-z0-9])${escapeRe(normalize(kw))}`);
const COMPILED = Object.fromEntries(TOPIC_IDS.map((t) => [t, TOPICS[t].keywords.map(matcher)]));

/** Tópicos de um texto, na ordem da taxonomia. */
export function extractTopics(text) {
  const n = normalize(text);
  return TOPIC_IDS.filter((t) => COMPILED[t].some((re) => re.test(n)));
}

/** Palavras-chave livres do usuário que aparecem no texto. */
export function matchKeywords(text, keywords) {
  if (!keywords?.length) return [];
  const n = normalize(text);
  return keywords.filter((kw) => kw.trim() && matcher(kw.trim()).test(n));
}
