// Catálogo da aba "Brasil em dados": o que mostrar, de onde vem e como conferir.
//
// Cada indicador tem fontes com um PAPEL na verificação tripla (docs/13):
//   origem        — quem produz o dado (conferência A);
//   republicacao  — outra instituição que copia o mesmo número: deve bater (conferência C);
//   independente  — outra instituição/método que mede o mesmo fenômeno (conferência B).
//
// `expect` é uma trava contra código errado: o nome que a fonte devolve precisa conter
// esse trecho. Os códigos abaixo seguem a documentação pública das APIs e PRECISAM ser
// confirmados com acesso à rede (ver docs/13 §12). Se um código estiver errado, o cartão
// mostra "fonte não confere" em vez de um número trocado.

export const CATALOG = [
  {
    id: 'inflacao',
    section: 'Preços',
    title: 'Inflação (IPCA) em 12 meses',
    unit: '%',
    decimals: 2,
    frequency: 'mensal',
    why: 'Quanto os preços subiram, em média, no último ano. Se o seu salário subiu menos do que isso, ele compra menos.',
    tolerance: 0.01,
    sources: [
      {
        key: 'ibge_ipca_12m',
        role: 'origem',
        institution: 'IBGE',
        kind: 'estatistica_oficial',
        adapter: 'ibge',
        params: { table: 1737, variable: 2265, locality: 'N1[all]' },
        expect: '12 meses',
        page: 'https://sidra.ibge.gov.br/tabela/1737',
      },
      {
        key: 'bcb_ipca_12m',
        role: 'republicacao',
        institution: 'Banco Central',
        kind: 'autarquia',
        adapter: 'bcb',
        params: { series: 13522 },
        page: 'https://www3.bcb.gov.br/sgspub/',
      },
    ],
  },
  {
    id: 'comida',
    section: 'Comida',
    title: 'Custo da cesta básica',
    unit: 'R$',
    decimals: 2,
    frequency: 'mensal',
    why: 'Quanto custa, por mês, a cesta de alimentos básicos de uma pessoa adulta na capital. Comparar com o salário mínimo mostra quanto do salário vai para comer.',
    compare: 'tendencia',
    sources: [
      {
        key: 'dieese_cesta_sp',
        role: 'origem',
        institution: 'DIEESE',
        kind: 'pesquisa_independente',
        adapter: 'dieese',
        params: { city: 'São Paulo' },
        page: 'https://www.dieese.org.br/cesta/',
      },
      {
        key: 'bcb_ipca_alimentos',
        role: 'independente',
        institution: 'IBGE (via Banco Central)',
        kind: 'estatistica_oficial',
        adapter: 'bcb',
        // IPCA - Alimentação e bebidas, variação mensal; o sistema acumula 12 meses.
        params: { series: 1635, accumulate12: true },
        label: 'Alta dos alimentos no IPCA (12 meses)',
        unit: '%',
        page: 'https://www3.bcb.gov.br/sgspub/',
      },
    ],
  },
  {
    id: 'emprego',
    section: 'Trabalho',
    title: 'Desemprego',
    unit: '%',
    decimals: 1,
    frequency: 'mensal (trimestre móvel)',
    why: 'Parte das pessoas que querem trabalhar e procuraram emprego, mas não acharam. Não conta quem desistiu de procurar.',
    tolerance: 0.05,
    sources: [
      {
        key: 'ibge_desocupacao',
        role: 'origem',
        institution: 'IBGE (PNAD Contínua)',
        kind: 'estatistica_oficial',
        adapter: 'ibge',
        params: { table: 6381, variable: 4099, locality: 'N1[all]' },
        expect: 'desocupação',
        page: 'https://sidra.ibge.gov.br/tabela/6381',
      },
      {
        key: 'bcb_desocupacao',
        role: 'republicacao',
        institution: 'Banco Central',
        kind: 'autarquia',
        adapter: 'bcb',
        params: { series: 24369 },
        page: 'https://www3.bcb.gov.br/sgspub/',
      },
    ],
  },
  {
    id: 'economia',
    section: 'Desenvolvimento',
    title: 'Crescimento da economia (PIB)',
    unit: '%',
    decimals: 1,
    frequency: 'trimestral',
    why: 'Quanto a produção do país cresceu em relação ao mesmo trimestre do ano anterior. Crescer não garante que a vida melhore para todos, mas sem crescer fica mais difícil.',
    compare: 'tendencia',
    sources: [
      {
        key: 'ibge_pib',
        role: 'origem',
        institution: 'IBGE (Contas Nacionais)',
        kind: 'estatistica_oficial',
        adapter: 'ibge',
        params: { table: 5932, variable: 6561, locality: 'N1[all]', classification: '11255[90707]' },
        expect: 'mesmo período do ano anterior',
        page: 'https://sidra.ibge.gov.br/tabela/5932',
      },
      {
        key: 'bcb_ibcbr',
        role: 'independente',
        institution: 'Banco Central (IBC-Br)',
        kind: 'autarquia',
        adapter: 'bcb',
        // Índice mensal de atividade (método próprio do BC): compara-se a direção em 12 meses.
        params: { series: 24363, yoy: true },
        label: 'Atividade econômica (IBC-Br), variação em 12 meses',
        unit: '%',
        page: 'https://www3.bcb.gov.br/sgspub/',
      },
    ],
  },
  {
    id: 'juros',
    section: 'Dinheiro',
    title: 'Juros básicos (Selic)',
    unit: '% ao ano',
    decimals: 2,
    frequency: 'a cada reunião do Copom',
    why: 'A taxa que serve de base para os juros de empréstimos, financiamentos e do cartão. Quando sobe, comprar a prazo fica mais caro.',
    single: 'É uma decisão do Banco Central, não uma medição: só existe uma fonte.',
    sources: [
      {
        key: 'bcb_selic_meta',
        role: 'origem',
        institution: 'Banco Central (Copom)',
        kind: 'autarquia',
        adapter: 'bcb',
        params: { series: 432 },
        page: 'https://www.bcb.gov.br/controleinflacao/historicotaxasjuros',
      },
    ],
  },
];

export const INDICATOR_IDS = CATALOG.map((i) => i.id);
export const byId = (id) => CATALOG.find((i) => i.id === id);
