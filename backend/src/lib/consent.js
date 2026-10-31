import { config } from '../config.js';

// Termo de consentimento do piloto (docs/16). Quem se cadastra aceita esta versão; quando o
// texto mudar de sentido, troque a VERSÃO: quem aceitou a anterior vê o termo novo ao entrar
// e escolhe entre aceitar ou levar os dados e sair.
export const CONSENT_VERSION = '2026-10-piloto-1';

/** O termo com os dados de quem conduz a pesquisa (variáveis RESEARCH_* do servidor). */
export function consentTerm() {
  const { responsible, contact, retention } = config.research;
  return {
    version: CONSENT_VERSION,
    title: 'Termo de consentimento do piloto',
    summary:
      'O Ágora é um protótipo de pesquisa acadêmica sobre redes sociais com algoritmo aberto, missões e moderação transparente. ' +
      'Participar é voluntário e sem pagamento. Você pode sair quando quiser, sem dar motivo: baixe seus dados e exclua a conta em Perfil › Privacidade e dados.',
    responsible,
    contact,
    sections: [
      {
        title: 'Quem conduz a pesquisa',
        items: [`${responsible}.`, `Dúvidas, pedidos e reclamações: ${contact}.`],
      },
      {
        title: 'O que o app guarda',
        items: [
          'Conta: nome de usuário, e-mail, nome de exibição e bio. A senha fica só como hash, que ninguém consegue ler.',
          'O que você publica: posts e edições, imagens (sem localização e sem outros metadados), mensagens, reações, curtidas, seguidas, recompensas, denúncias e recursos.',
          'Uso do app: minutos ativos por dia (dá para desligar em Interesses), missões, NewCoin e o que o feed "Para você" aprendeu dos seus interesses (você vê e apaga em Interesses).',
          'Sessões: o tipo de aparelho e navegador e as datas em que você entrou. O endereço IP não vai para o banco: fica só alguns minutos na memória do controle de limites.',
        ],
      },
      {
        title: 'Para quê',
        items: [
          'Fazer o app funcionar e moderar conforme as regras da instância.',
          'Pesquisa: entender como as pessoas usam uma rede assim. A análise usa números agregados (quantos posts, quanto tempo, quais recursos). Nenhum post seu é citado em trabalho da pesquisa com seu nome ou seu @.',
        ],
      },
      {
        title: 'O que não fazemos',
        items: [
          'Não vendemos nem passamos seus dados para empresas. Não há anúncios nem rastreadores de terceiros.',
          'O app não se conecta ao X, ao Telegram nem a outras redes.',
          'A NewCoin não é dinheiro: não compra nada e não vale nada fora do app.',
        ],
      },
      {
        title: 'Quem vê o quê',
        items: [
          'Seus posts e seu perfil: as pessoas da instância e quem abrir o endereço dela como visitante.',
          'Mensagens: quem está no canal ou grupo.',
          'Denúncias e recursos: a moderação da instância.',
          'O banco de dados inteiro: só a equipe da pesquisa, que cuida do servidor.',
        ],
      },
      {
        title: 'Por quanto tempo',
        items: [`Enquanto durar o piloto. ${retention}`],
      },
      {
        title: 'Riscos e cuidados',
        items: [
          'Como em qualquer rede, alguém pode ver ou copiar o que você publica.',
          'É um protótipo: pode ter falhas e sair do ar. Não publique dados sensíveis (saúde, endereço, documentos, senhas).',
        ],
      },
      {
        title: 'Seus direitos (LGPD, art. 18)',
        items: [
          'Ver e baixar todos os seus dados, corrigir seu perfil e excluir a conta, sozinho(a), em Perfil › Privacidade e dados.',
          'Retirar o consentimento a qualquer momento: é só excluir a conta. Nada do que é seu fica.',
          `Pedir qualquer outra coisa pelo contato acima: ${contact}.`,
        ],
      },
    ],
    accept_label: 'Tenho 18 anos ou mais, li o termo e aceito participar do piloto. Sei que posso sair quando quiser.',
  };
}
