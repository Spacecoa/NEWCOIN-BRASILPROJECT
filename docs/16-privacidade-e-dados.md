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

O arquivo não fica em cache (`Cache-Control: no-store`) e cada pessoa pode pedir até 5 por hora.

## 2. Excluir minha conta

*Perfil › Privacidade e dados › Excluir minha conta* explica o que acontece, pede para marcar "a exclusão é definitiva" e pede a senha de novo (rota `DELETE /api/conta`). Senha errada responde 403 e não derruba a sessão; há limite de 5 tentativas a cada 15 minutos, para a rota não virar um lugar de testar senhas.

**O que some:** a conta e tudo o que é dela: posts (e reposts e citações dela), imagens, mensagens, reações, curtidas, seguidas, carteira e extrato, missões, interesses, atividade, notificações, sessões, convites que ela criou, denúncias que ela fez e decisões sobre ela. O banco faz isso em cascata (`ON DELETE CASCADE`), numa transação só.

**O que o app arruma para as outras pessoas:**

- **Números dos posts dos outros:** curtidas, respostas, reposts, citações e recompensas são **recontados** nos posts que a conta tocou (recontar, e não "menos um", deixa o número certo mesmo que a conta tenha curtido, respondido e recompensado o mesmo post).
- **Canais:** um canal com mais gente passa para o administrador mais antigo (ou, sem administrador, o membro mais antigo). Canal sem mais ninguém some.
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

## 5. Testes

`backend/test/account.test.js` (9 testes): arquivo completo e sem segredos; sem o nome de quem denunciou; senha errada; tudo apagado e sessões encerradas; e-mail livre e @ reservado; números dos posts dos outros; canais passados ou apagados; convite que não volta; última pessoa moderando. `backend/test/consent.test.js` (5 testes): termo público e completo; aceite obrigatório e gravado; termo que mudou durante a leitura; conta com termo antigo aceita depois; situação do termo só para a própria pessoa. `frontend/src/pages/Privacy.test.jsx`: baixar o arquivo e excluir com senha errada e certa. `frontend/src/pages/Consent.test.jsx`: página `/termo` com e sem conta, termo novo antes do app, *Não aceito*. Simulações (docs/15): S101 a S103 na API (arquivo, exclusão, termo) e S104 e S105 na tela (a página inteira com download e exclusão; `/termo` e o termo novo antes do app). A S077 confere os dois aceites no cadastro.
