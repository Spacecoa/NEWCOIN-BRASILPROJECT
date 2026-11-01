# Privacidade e dados do piloto

**Data:** 31/10/2026 · **Escopo:** baixar os próprios dados, excluir a conta, a página *Privacidade e dados* e o termo de consentimento do piloto.

Antes de abrir o Ágora para as primeiras pessoas de verdade (5 a 10, num piloto de pesquisa), cada pessoa precisa conseguir, sozinha e pelo próprio app:

1. **levar uma cópia** de tudo o que a instância guarda sobre ela;
2. **sair de vez**, apagando a conta e o que é dela;
3. **saber, antes de entrar**, o que será coletado, para quê e por quanto tempo.

São os direitos de acesso, portabilidade e eliminação da LGPD (Lei 13.709/2018, art. 18) e o consentimento livre e informado da pesquisa (art. 7º, I, e art. 13). Este documento explica como o app faz cada um.

## 1. Baixar meus dados

*Perfil › Privacidade e dados › Baixar meus dados* gera um arquivo `agora-dados-<usuario>-<data>.json` (rota `GET /api/conta/dados`).

| O que vai no arquivo | O que fica de fora, e por quê |
|---|---|
| Conta (usuário, e-mail, nome, bio, datas, aceite das regras) | Hash da senha, dos refresh tokens e dos links de nova senha: são segredos, não dados |
| Posts com todas as edições, inclusive os removidos pela moderação | Quem denunciou você: protege quem denuncia (docs/11) |
| Imagens (base64, já sem metadados) e textos alternativos | Quem moderou cada decisão: a decisão e a regra vão; o nome, não |
| Curtidas, seguindo, seguidores, silenciados, bloqueados, posts ocultados | Posts, mensagens e dados de outras pessoas (só os ids do que você curtiu) |
| Canais, mensagens e reações | |
| NewCoin: saldo, extrato, recompensas dadas, missões | |
| Atividade por dia e preferências guardadas no servidor (missões, contar tempo) | |
| O que o feed "Para você" aprendeu **neste aparelho**: o app junta ao arquivo, porque o servidor não tem (docs/07 §2.10) | |
| Denúncias que você fez, decisões sobre sua conta e recursos | |
| Convites, notificações, sessões (aparelho e datas) e pedidos de nova senha | |

O arquivo não fica em cache (`Cache-Control: no-store`) e cada pessoa pode pedir até 5 por hora. As imagens vão dentro do arquivo até somarem 50 MB; as que passam disso vão só com os dados e o endereço `/api/midia/<id>` (se ainda não estão num post, sem endereço). Assim o servidor nunca monta um arquivo gigante na memória.

## 2. Excluir minha conta

*Perfil › Privacidade e dados › Excluir minha conta* explica o que acontece, pede para marcar "a exclusão é definitiva" e pede a senha de novo (rota `DELETE /api/conta`). Senha errada responde 403 e não derruba a sessão; há limite de 5 tentativas a cada 15 minutos, para a rota não virar um lugar de testar senhas.

**O que some:** a conta e tudo o que é dela: posts (e reposts e citações dela), imagens, mensagens, reações, curtidas, seguidas, carteira e extrato, missões, interesses, atividade, notificações, sessões, convites que ela criou, denúncias que ela fez e decisões sobre ela. O banco faz isso em cascata (`ON DELETE CASCADE`), numa transação só.

**O que o app arruma para as outras pessoas:**

- **Números dos posts dos outros:** curtidas, respostas, reposts, citações e recompensas são **recontados** nos posts que a conta tocou (recontar, e não "menos um", deixa o número certo mesmo que a conta tenha curtido, respondido e recompensado o mesmo post).
- **Canais:** um canal com mais gente passa para o administrador mais antigo (ou, sem administrador, o membro mais antigo). Conta suspensa não herda. Canal sem mais ninguém ativo some.
- **Telas abertas:** as sessões caem na hora e os posts saem da tela de quem seguia a conta (evento `post:deleted`).
- **Este aparelho:** o app apaga o algoritmo do "Para você" guardado no navegador. Nos outros aparelhos ele fica até a pessoa limpar os dados do site (o app não tem como alcançá-los depois que a conta some).
- **NewCoin recebida por outras pessoas** continua delas: o extrato de cada carteira segue batendo com o saldo.

**O que fica:**

- **O hash do nome de usuário** (tabela `deleted_usernames`), para ninguém se cadastrar depois com o mesmo @ e herdar as menções antigas, como no Mastodon. É um SHA-256 do nome em minúsculas; o e-mail fica livre.
- **Respostas de outras pessoas** aos posts apagados continuam, sem o post original (o mesmo que acontece quando alguém apaga um post).

**Cuidados da instância:**

- **A única pessoa que modera não pode sair** sem passar a moderação para outra (409). Senão a instância ficaria sem moderação.
- Se o nome estava na lista `MODERATORS`, ele vai para `moderator_names_missing`: quem criar uma conta com esse nome depois não vira moderador sozinho (docs/14).
- **O convite usado não volta a valer.** O convite marca quem o usou (`used_by`), e esse campo vira vazio quando a conta é excluída; por isso o app passou a olhar `used_at`. Antes desta mudança, excluir a conta liberava o convite para outra pessoa.
- **Conta suspensa** não consegue entrar, então não chega na tela de excluir. Ela pede a quem administra a instância, que roda `npm run conta:excluir -- <usuario> --confirmo` no servidor (faz o mesmo que o botão, sem pedir a senha).

## 3. A página *Privacidade e dados*

Em *Perfil › Privacidade e dados* (antes *Bloqueios e denúncias*). A página foi revista para o piloto e agora começa pelo que a pessoa precisa saber antes de usar o app:

1. **Quem vê o quê**, em quatro linhas:
   - **Público:** posts, respostas e perfil (nome, bio, quem a pessoa segue), para a instância e para visitantes.
   - **Restrito:** mensagens de canais (quem tem conta), de grupos (só membros), denúncias e recursos (só a moderação).
   - **Só você:** esta página, a carteira, as notificações e o que o "Para você" aprendeu, que fica no aparelho.
   - **Não guardamos:** IP no banco, localização das fotos, anúncios ou rastreadores; sem conexão com X ou Telegram.

   Logo abaixo: a data em que a pessoa aceitou o termo, o link para lê-lo, o link para a contagem de tempo e o aprendizado do feed (em *Interesses*) e o contato da equipe para dúvidas sobre dados.
2. **Seus dados:** *Baixar meus dados* (§1) e *Excluir minha conta* (§2).
3. O que já existia: decisões sobre a conta (com recurso), bloqueados, silenciados e o andamento das denúncias.

Depois de excluir a conta, o app volta para a leitura de visitante com o aviso *"Sua conta foi excluída"* no topo, como acontece ao sair.

## 4. Termo de consentimento do piloto

**Onde aparece:** no cadastro (caixa *Termo de consentimento do piloto*, com o texto inteiro e o link para a página), na página pública `/termo` (dá para ler sem conta) e, para quem já tem conta, como uma tela antes do app quando falta aceitar a versão atual.

**O que o termo diz** (texto em `backend/src/lib/consent.js`, servido por `GET /api/instancia/termo`):

| Seção | Resumo |
|---|---|
| Quem conduz a pesquisa | Nome da equipe e contato (variáveis `RESEARCH_RESPONSIBLE` e `RESEARCH_CONTACT` do servidor) |
| O que o app guarda | Conta; o que a pessoa publica; uso do app (minutos por dia, que dá para desligar, missões, NewCoin); sessões. O que o "Para você" aprende fica só no aparelho. O IP não vai para o banco |
| Para quê | Fazer o app funcionar e moderar; pesquisa com números agregados, sem citar posts com nome ou @ |
| O que não fazemos | Sem venda de dados, anúncios ou rastreadores; sem conexão com X ou Telegram; NewCoin não é dinheiro |
| Quem vê o quê | Posts e perfil: a instância e visitantes; mensagens: quem está no canal; denúncias: a moderação; o banco: só a equipe |
| Por quanto tempo | Enquanto durar o piloto, mais o prazo de `RESEARCH_RETENTION` (padrão: apagar em até 6 meses depois do fim) |
| Riscos e cuidados | O que se publica pode ser copiado; é um protótipo; não publique dados sensíveis |
| Seus direitos (LGPD, art. 18) | Baixar, corrigir e excluir pelo app; retirar o consentimento é excluir a conta |

O aceite é uma caixa só: *"Tenho 18 anos ou mais, li o termo e aceito participar do piloto. Sei que posso sair quando quiser."* A idade mínima evita a necessidade do consentimento dos responsáveis, que o app não tem como colher.

**Como o app guarda o aceite:** `users.consent_version` e `users.consent_at`. O cadastro exige `accept_consent: true` e grava a versão atual (`CONSENT_VERSION`). Se a tela mandar `consent_version` diferente da atual (o termo mudou enquanto a pessoa lia), o cadastro responde 409 e pede para reler.

**Quando o termo muda:** quem cuida do servidor troca `CONSENT_VERSION`. No próximo login, a conta recebe `consent.pending: true` (só a própria pessoa vê isso, em `/api/auth/me`, no login e na renovação) e o app mostra o termo novo antes de qualquer tela. Ela pode:

- **aceitar** (`POST /api/conta/termo` com a versão lida; versão diferente da atual dá 409);
- **não aceitar**: o app oferece baixar os dados, excluir a conta ou sair e decidir depois.

Enquanto o aceite estiver pendente, o app não conta os minutos de uso.

**Limite conhecido:** quem bloqueia o app enquanto o aceite está pendente é a tela, não o servidor. Uma pessoa que chame a API direto, sem o app, continua conseguindo usar a conta. Para um piloto de 5 a 10 pessoas convidadas, a tela basta; numa instância aberta, o servidor também teria de recusar as ações.

**Antes de abrir o piloto, quem cuida do servidor:**

1. define `RESEARCH_RESPONSIBLE`, `RESEARCH_CONTACT` e `RESEARCH_RETENTION` (o servidor avisa no log quando o contato está vazio);
2. confere se o termo bate com o projeto aprovado pela instituição. Se a pesquisa passar por comitê de ética, o texto aprovado é o que vale: ajuste `consent.js` e troque a versão.

## 5. Verificação de segurança (31/10/2026)

Revisão do módulo com testes de sondagem: corridas entre pedidos, tokens de conta já excluída, dados de outras pessoas, campos a mais no cadastro, pedidos sobre a conta de outra pessoa e abuso do arquivo de dados. Tudo local, com contas fictícias.

**Achados e correções:**

| # | Gravidade | Falha | Correção |
|---|---|---|---|
| V1 | Média | Duas moderadoras excluindo a conta ao mesmo tempo: cada uma via a outra e as duas saíam, e a instância ficava **sem moderação** | A conferência passou para dentro da transação e trava as contas que moderam. Uma sai e a outra recebe 409 |
| V2 | Média | O arquivo de dados levava **todas** as imagens em base64. Uma conta com muitas imagens fazia o servidor montar centenas de MB na memória a cada pedido, com risco de derrubá-lo | Teto de 50 MB de imagens no arquivo; as demais vão com o endereço |
| V3 | Baixa | Conta **suspensa** podia herdar um canal (e voltar mandando nele se fosse reativada) | O herdeiro precisa estar ativo |
| V4 | Baixa | Token de conta excluída que escapa da lista de sessões encerradas (Redis reiniciado) ou pedido feito durante a própria exclusão davam **erro 500** | Chave estrangeira sem par vira 401 (se o que sumiu foi a própria conta) ou 404 (se foi outra coisa); `/api/auth/me` responde 401 |
| V5 | Baixa | "Esqueci minha senha" esperava o envio do e-mail só quando a conta existia. Com um serviço de e-mail de verdade, a demora revelaria quem tem conta | O envio não segura mais a resposta |

**Conferido e sem falha:**

- O perfil público e a busca não mostram e-mail nem a situação do termo.
- Campos a mais no cadastro (`is_moderator`, versão do termo inventada) são ignorados.
- As rotas de conta só agem sobre a conta do token; mandar o nome de outra pessoa não muda nada.
- Exclusão e arquivo de dados exigem login. A exclusão pede a senha, não é alcançável por outro site (o token vai no cabeçalho, não em cookie) e tem limite de tentativas.
- O nome do arquivo usa só o @ (letras, números e `_`), sem como injetar cabeçalho.
- Os contadores dos posts das outras pessoas ficam certos mesmo com curtidas chegando durante a exclusão.

**O que fica em aberto, por decisão ou para depois:**

- **Voltar depois de excluir:** quem exclui a conta (por exemplo, com denúncias em análise) pode criar outra com o mesmo e-mail. Para um piloto com convites, a moderação resolve; numa instância aberta, valeria guardar o hash do e-mail de contas excluídas com sanção ativa.
- **O termo é cobrado pela tela, não pela API** (§4).
- **O hash do @ reservado não tem sal:** quem testar nomes descobre que @fulano existiu. Os nomes já eram públicos.
- **E-mail no log:** com `MAIL_TRANSPORT=log`, o link de nova senha aparece no log do servidor. Num piloto, o log precisa ficar só com a equipe, até existir um serviço de e-mail.
- **Recontagem sob corrida:** se alguém curte o mesmo post exatamente durante a exclusão, o número pode ficar um a menos até a próxima mudança no post. É raro, e o teste com curtidas simultâneas não reproduziu.

## 6. Testes

`backend/test/account.test.js` (14 testes, 5 deles da verificação do §5): arquivo completo e sem segredos; sem o nome de quem denunciou; senha errada; tudo apagado e sessões encerradas; e-mail livre e @ reservado; números dos posts dos outros; canais passados ou apagados; convite que não volta; última pessoa moderando. `backend/test/consent.test.js` (5 testes): termo público e completo; aceite obrigatório e gravado; termo que mudou durante a leitura; conta com termo antigo aceita depois; situação do termo só para a própria pessoa. `frontend/src/pages/Privacy.test.jsx`: baixar o arquivo e excluir com senha errada e certa. `frontend/src/pages/Consent.test.jsx`: página `/termo` com e sem conta, termo novo antes do app, *Não aceito*. Simulações (docs/15): S101 a S103 na API (arquivo, exclusão, termo) e S104 e S105 na tela (a página inteira com download e exclusão; `/termo` e o termo novo antes do app). A S077 confere os dois aceites no cadastro.
