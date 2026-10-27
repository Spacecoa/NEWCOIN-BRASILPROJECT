// Missões diárias de organização popular.
//
// Diferente da gamificação comum, aqui NÃO existem pontos, sequências (streaks),
// rankings individuais nem notificações cobrando. Cada missão:
//  - pede uma ação que cria valor para OUTRA pessoa ou para a rede;
//  - é verificada pelo que de fato aconteceu (não dá para "farmar" postando muito);
//  - pode ser pulada sem custo;
//  - some à meia-noite (horário da instância) e volta outra combinação no dia seguinte.
// Ver docs/08-missoes-organizacao-popular.md.

export const MISSIONS_PER_DAY = 3;

export const CATALOG = {
  apresentar: {
    title: 'Apresente-se',
    description: 'Escreva um post contando quem você é e o que te interessa.',
    why: 'Quem se apresenta recebe boas-vindas e encontra sua turma mais rápido.',
  },
  boas_vindas: {
    title: 'Dê boas-vindas',
    description: 'Responda ou mencione alguém que entrou nesta semana.',
    why: 'A primeira resposta decide se alguém fica. Ninguém deveria falar sozinho no primeiro dia.',
  },
  responder_pergunta: {
    title: 'Responda quem perguntou',
    description: 'Seja a primeira resposta de uma pergunta que ainda não teve nenhuma.',
    why: 'Pergunta sem resposta é o sinal mais claro de uma rede que não escuta.',
  },
  ponte: {
    title: 'Construa uma ponte',
    description: 'Siga alguém que ninguém do seu círculo segue ainda.',
    why: 'Conexões fora da bolha espalham ideias e evitam câmaras de eco.',
  },
  amplificar: {
    title: 'Amplifique uma voz pequena',
    description: 'Reposte algo bom de quem tem menos de 5 seguidores.',
    why: 'Distribuir atenção, em vez de concentrá-la, é o que faz a rede crescer por inteiro.',
  },
  conversa_coletiva: {
    title: 'Participe de uma conversa coletiva',
    description: 'Mande uma mensagem em um grupo.',
    why: 'Grupos são onde a rede se organiza para além do feed.',
  },
  organizar: {
    title: 'Abra um espaço',
    description: 'Crie um grupo para um tema, bairro, turma ou causa que ainda não tem lugar aqui.',
    why: 'Toda organização popular começa com alguém abrindo a sala.',
  },
  convidar: {
    title: 'Traga alguém de confiança',
    description: 'Gere um convite e envie a uma pessoa que você gostaria de ver aqui. Conta quando ela entrar.',
    why: 'Redes saudáveis crescem de pessoa para pessoa, por confiança, não por anúncio.',
  },
};

export const MISSION_IDS = Object.keys(CATALOG);

/** Hash FNV-1a de 32 bits: estável entre execuções e plataformas. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Escolhe as missões do dia de forma determinística (mesma pessoa + mesmo dia = mesmas missões).
 * `applicable` = ids que fazem sentido agora (ex.: só sugere boas-vindas se há gente nova).
 * Pessoas novas sempre recebem "apresentar" primeiro.
 */
export function selectMissions(userId, day, applicable, { isNewUser = false } = {}) {
  const pool = applicable.filter((id) => CATALOG[id] && id !== 'apresentar');
  const ordered = pool
    .map((id) => ({ id, k: hash(`${userId}:${day}:${id}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.id);
  const first = isNewUser && applicable.includes('apresentar') ? ['apresentar'] : [];
  return [...first, ...ordered].slice(0, MISSIONS_PER_DAY);
}

export const PRINCIPLES = [
  'Sem pontos, sem sequências e sem ranking individual.',
  'Cada missão beneficia outra pessoa ou a rede inteira.',
  'Conclusão verificada pelo que aconteceu de fato, não por autodeclaração.',
  'Pular não tem custo. Nenhuma notificação cobra missões.',
  'Três por dia, no máximo. Renovam à meia-noite.',
];
