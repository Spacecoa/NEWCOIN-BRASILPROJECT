// Missões diárias.
//
// Duas famílias, todas feitas DENTRO do app e online (nada físico, nada fora da rede):
//  - engajamento: curtir, republicar, comentar, recompensar, tempo ativo no app;
//  - rede: ações que ajudam a comunidade a crescer de forma orgânica.
// Cada missão concluída credita uma quantidade fixa do token interno (uma vez por dia).
// Continuam de fora: sequências (streaks), ranking individual e notificações cobrando.
// Ver docs/08-missoes-organizacao-popular.md e docs/09-token-interno.md.

export const PER_FAMILY = { engajamento: 2, rede: 2 };
export const MISSIONS_PER_DAY = PER_FAMILY.engajamento + PER_FAMILY.rede;

export const CATALOG = {
  // --- engajamento (metas numéricas, com regra de qualidade) ---
  curtir: {
    family: 'engajamento',
    reward: 2,
    target: 5,
    title: 'Curta 5 posts',
    description: 'Curta 5 posts de pelo menos 3 pessoas diferentes.',
    why: 'Curtir mostra a quem escreveu que alguém leu.',
  },
  republicar: {
    family: 'engajamento',
    reward: 2,
    target: 2,
    title: 'Republique 2 posts',
    description: 'Reposte 2 posts de outras pessoas.',
    why: 'Republicar leva boas ideias para quem ainda não viu.',
  },
  comentar: {
    family: 'engajamento',
    reward: 3,
    target: 3,
    title: 'Comente 3 posts',
    description: 'Responda 3 posts de outras pessoas com pelo menos 15 caracteres.',
    why: 'Comentários de verdade transformam posts em conversa.',
  },
  recompensar: {
    family: 'engajamento',
    reward: 1,
    target: 1,
    title: 'Recompense alguém',
    description: 'Dê 1 token a um post de outra pessoa que valeu sua leitura.',
    why: 'O token circula quando quem lê reconhece quem escreve.',
  },
  tempo_no_app: {
    family: 'engajamento',
    reward: 1,
    target: 10,
    title: 'Fique 10 minutos ativo',
    description: 'Use o app por 10 minutos hoje (só conta com a tela aberta e uso recente).',
    why: 'Tempo de leitura e conversa dentro da rede.',
  },

  // --- rede (organização popular) ---
  apresentar: {
    family: 'rede',
    reward: 2,
    title: 'Apresente-se',
    description: 'Escreva um post contando quem você é e o que te interessa.',
    why: 'Quem se apresenta recebe boas-vindas e encontra sua turma mais rápido.',
  },
  boas_vindas: {
    family: 'rede',
    reward: 3,
    title: 'Dê boas-vindas',
    description: 'Responda ou mencione alguém que entrou nesta semana.',
    why: 'A primeira resposta decide se alguém fica. Ninguém deveria falar sozinho no primeiro dia.',
  },
  responder_pergunta: {
    family: 'rede',
    reward: 3,
    title: 'Responda quem perguntou',
    description: 'Seja a primeira resposta de uma pergunta que ainda não teve nenhuma.',
    why: 'Pergunta sem resposta é o sinal mais claro de uma rede que não escuta.',
  },
  ponte: {
    family: 'rede',
    reward: 2,
    title: 'Construa uma ponte',
    description: 'Siga alguém que ninguém do seu círculo segue ainda.',
    why: 'Conexões fora da bolha espalham ideias e evitam câmaras de eco.',
  },
  amplificar: {
    family: 'rede',
    reward: 2,
    title: 'Amplifique uma voz pequena',
    description: 'Reposte algo bom de quem tem menos de 5 seguidores.',
    why: 'Distribuir atenção, em vez de concentrá-la, é o que faz a rede crescer por inteiro.',
  },
  conversa_coletiva: {
    family: 'rede',
    reward: 2,
    title: 'Participe de uma conversa coletiva',
    description: 'Mande uma mensagem em um grupo.',
    why: 'Grupos são onde a rede se organiza para além do feed.',
  },
  organizar: {
    family: 'rede',
    reward: 4,
    title: 'Abra um espaço',
    description: 'Crie um grupo para um tema, turma ou causa que ainda não tem lugar aqui.',
    why: 'Toda organização popular começa com alguém abrindo a sala.',
  },
  convidar: {
    family: 'rede',
    reward: 4,
    title: 'Traga alguém de confiança',
    description: 'Gere um convite e envie a uma pessoa que você gostaria de ver aqui. Conta quando ela entrar.',
    why: 'Redes saudáveis crescem de pessoa para pessoa, por confiança, não por anúncio.',
  },
};

export const MISSION_IDS = Object.keys(CATALOG);
/** Teto teórico diário: as maiores recompensas possíveis dentro de cada família. */
export const MAX_DAILY_REWARD = Object.entries(PER_FAMILY).reduce(
  (total, [family, n]) =>
    total +
    Object.values(CATALOG)
      .filter((m) => m.family === family)
      .map((m) => m.reward)
      .sort((a, b) => b - a)
      .slice(0, n)
      .reduce((a, b) => a + b, 0),
  0,
);

/** Hash FNV-1a de 32 bits: estável entre execuções e plataformas. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const shuffled = (ids, userId, day) =>
  ids
    .map((id) => ({ id, k: hash(`${userId}:${day}:${id}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.id);

/**
 * Escolhe as missões do dia de forma determinística (mesma pessoa + mesmo dia = mesmas missões):
 * 2 de engajamento + 2 de rede, entre as aplicáveis. Pessoas novas recebem "apresentar" primeiro.
 */
export function selectMissions(userId, day, applicable, { isNewUser = false } = {}) {
  const valid = applicable.filter((id) => CATALOG[id]);
  const engajamento = shuffled(valid.filter((id) => CATALOG[id].family === 'engajamento'), userId, day).slice(0, PER_FAMILY.engajamento);
  const redePool = shuffled(valid.filter((id) => CATALOG[id].family === 'rede' && id !== 'apresentar'), userId, day);
  const rede = [...(isNewUser && valid.includes('apresentar') ? ['apresentar'] : []), ...redePool].slice(0, PER_FAMILY.rede);
  return [...rede, ...engajamento];
}

export const PRINCIPLES = [
  'Cada missão concluída rende uma quantia fixa de token interno, creditada uma vez por dia.',
  'Todas são feitas dentro do app: curtir, republicar, comentar, recompensar, conversar e convidar.',
  'Sem sequências e sem ranking individual. Pular não tem custo.',
  'Conclusão verificada pelas ações reais, com regras de qualidade para evitar spam.',
  'Até 4 missões por dia. Renovam à meia-noite.',
];
