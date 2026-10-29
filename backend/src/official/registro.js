// Registro conferido à mão da aba "Brasil em dados".
//
// Os números abaixo foram lidos nas publicações oficiais de cada instituição e conferidos
// em pelo menos mais um lugar (outra página da mesma instituição ou a imprensa). Eles NÃO
// se atualizam sozinhos: quando sair dado novo, alguém confere de novo e edita este arquivo
// (ver docs/13 §13). O servidor carrega o registro ao iniciar e guarda o conteúdo com sha256,
// como faz com uma resposta de API.
//
// Regras do registro:
//  - só entra número que apareceu na publicação da própria fonte (campo `url`);
//  - `evidence` lista onde o mesmo número também foi encontrado;
//  - fonte sem número confirmado fica de fora (o cartão mostra que falta), nunca estimada;
//  - divergência encontrada vai em `note`, com a escolha feita e o porquê.
//
// Períodos no mesmo formato dos leitores: 'AAAAMM' (mensal, ou fim do trimestre móvel)
// e 'AAAATn' (trimestral).

export const REGISTRO = {
  checked_at: '2026-10-29',
  sources: {
    ibge_ipca_12m: {
      published: '2026-10-09',
      url: 'https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa/2013-agencia-de-noticias/releases/48246-ipca-fica-em-0-82-em-setembro',
      observations: [
        { period: '202608', value: 4.22 },
        { period: '202609', value: 4.58 },
      ],
      evidence: [
        { label: 'IBGE, caderno do IPCA de setembro', url: 'https://biblioteca.ibge.gov.br/visualizacao/periodicos/236/inpc_ipca_2026_set.pdf' },
        { label: 'IBGE, release em inglês', url: 'https://agenciadenoticias.ibge.gov.br/en/agencia-press-room/2185-news-agency/releases-en/48266-ipca-stands-at-0-82-in-september' },
        { label: 'Investidor10', url: 'https://investidor10.com.br/indices/ipca/' },
      ],
      note: 'No mês, o IPCA de setembro foi 0,82%; no ano, 3,95%.',
    },
    dieese_cesta_sp: {
      published: '2026-10',
      url: 'https://www.dieese.org.br/analisecestabasica/2026/202609cestabasica.pdf',
      observations: [
        { period: '202608', value: 900.59 },
        { period: '202609', value: 922.51 },
      ],
      evidence: [
        { label: 'InfoMoney', url: 'https://www.infomoney.com.br/economia/dieese-custo-da-cesta-basica-sobe-em-todas-as-27-capitais-pela-2a-vez-consecutiva/' },
        { label: 'Mix Vale', url: 'https://www.mixvale.com.br/2026/10/18/cesta-basica-em-2026-sobe-nas-27-capitais-atinge-r-92251-em-sao-paulo/' },
      ],
      note: 'Em São Paulo, a cesta subiu 2,43% no mês e 9,53% em 12 meses (DIEESE). Foi a mais cara entre as 27 capitais.',
    },
    ibge_desocupacao: {
      published: '2026-09-29',
      url: 'https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa/2013-agencia-de-noticias/releases/48148-pnad-continua-taxa-de-desocupacao-e-de-5-3-e-taxa-de-subutilizacao-e-de-13-1-no-trimestre-encerrado-em-agosto',
      // 202605 = mar–mai e 202608 = jun–ago (release acima); 202606 = abr–jun (release do 2º trimestre).
      observations: [
        { period: '202605', value: 5.6 },
        { period: '202606', value: 5.4 },
        { period: '202608', value: 5.3 },
      ],
      evidence: [
        { label: 'IBGE, PNAD Contínua do 2º trimestre', url: 'https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa/2013-agencia-de-noticias/releases/47774-pnad-continua-trimestral-desocupacao-cai-em-13-das-27-ufs-no-2-trimestre-de-2026' },
        { label: 'IBGE, caderno da PNAD de agosto', url: 'https://biblioteca.ibge.gov.br/visualizacao/periodicos/3086/pnacm_2026_ago.pdf' },
        { label: 'ADVFN', url: 'https://br.advfn.com/jornal/2026/09/pnad-continua-desocupacao-fica-em-5-3-no-brasil-no-trimestre-ate-agosto-diz-ibge' },
      ],
      note: 'Trimestre de junho a agosto de 2026: cerca de 5,8 milhões de pessoas procurando trabalho. O trimestre até setembro ainda não tinha sido divulgado.',
    },
    ibge_pib: {
      published: '2026-09-01',
      url: 'https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa/2013-agencia-de-noticias/releases/47902-pib-cresce-0-5-no-segundo-trimestre-de-2026',
      observations: [{ period: '2026T2', value: 2.0 }],
      evidence: [
        { label: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/economia/noticia/2026-09/pib-do-brasil-cresce-05-no-segundo-trimestre-mostra-ibge' },
        { label: 'CNN Brasil', url: 'https://www.cnnbrasil.com.br/economia/money/macroeconomia/pib-economia-brasileira-cresce-05-no-2o-trimestre-de-2026-aponta-ibge/' },
      ],
      note: 'Contra o 1º trimestre de 2026 (com ajuste sazonal), o PIB cresceu 0,5%. Em quatro trimestres, 1,9%.',
    },
    bcb_ibcbr: {
      published: '2026-10-16',
      url: 'https://www.bcb.gov.br/en/statistics/ibc-br-en',
      observations: [{ period: '202608', value: 1.2 }],
      evidence: [
        { label: 'Correio Braziliense', url: 'https://www.correiobraziliense.com.br/economia/2026/10/7521927-previa-do-pib-ibc-br-sobe-03-em-agosto.html' },
        { label: 'Boca', url: 'https://boca.com.br/economia/ibc-br-registra-alta-agosto-2026' },
      ],
      note: 'IBC-Br de agosto contra agosto de 2025: +1,2% segundo o Banco Central e a imprensa. Um agregador (Atlas Público) informa 1,45%; ficamos com o número do Banco Central.',
    },
    bcb_selic_meta: {
      published: '2026-09-16',
      url: 'https://www.bcb.gov.br/en/monetarypolicy/copomstatements',
      // Valor em vigor no fim de cada mês com decisão do Copom.
      observations: [
        { period: '202606', value: 14.25 },
        { period: '202608', value: 14.0 },
        { period: '202609', value: 13.75 },
      ],
      evidence: [
        { label: 'Banco Central, comunicado do corte para 14,00%', url: 'https://www.bcb.gov.br/en/pressdetail/2680/nota' },
        { label: 'CNN Brasil', url: 'https://www.cnnbrasil.com.br/economia/money/macroeconomia/bc-copom-selic-juros-setembro-2026/' },
      ],
      note: 'Corte de 0,25 ponto na 281ª reunião do Copom (16/09/2026), o quinto seguido.',
    },
  },
};
