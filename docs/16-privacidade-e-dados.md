# Privacidade e dados do piloto

**Data:** 31/10/2026 · **Escopo:** baixar os próprios dados, excluir a conta, termo de consentimento da pesquisa e a página *Privacidade e dados*.

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
| Atividade por dia, interesses (preferências e o que o algoritmo aprendeu) | |
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
- **NewCoin recebida por outras pessoas** continua delas: o extrato de cada carteira segue batendo com o saldo.

**O que fica:**

- **O hash do nome de usuário** (tabela `deleted_usernames`), para ninguém se cadastrar depois com o mesmo @ e herdar as menções antigas, como no Mastodon. É um SHA-256 do nome em minúsculas; o e-mail fica livre.
- **Respostas de outras pessoas** aos posts apagados continuam, sem o post original (o mesmo que acontece quando alguém apaga um post).

**Cuidados da instância:**

- **A única pessoa que modera não pode sair** sem passar a moderação para outra (409). Senão a instância ficaria sem moderação.
- Se o nome estava na lista `MODERATORS`, ele vai para `moderator_names_missing`: quem criar uma conta com esse nome depois não vira moderador sozinho (docs/14).
- **O convite usado não volta a valer.** O convite marca quem o usou (`used_by`), e esse campo vira vazio quando a conta é excluída; por isso o app passou a olhar `used_at`. Antes desta mudança, excluir a conta liberava o convite para outra pessoa.
- **Conta suspensa** não consegue entrar, então não chega na tela de excluir. Ela pede a quem administra a instância, que roda `npm run conta:excluir -- <usuario> --confirmo` no servidor (faz o mesmo que o botão, sem pedir a senha).

## 3. Testes

`backend/test/account.test.js` (9 testes): arquivo completo e sem segredos; sem o nome de quem denunciou; senha errada; tudo apagado e sessões encerradas; e-mail livre e @ reservado; números dos posts dos outros; canais passados ou apagados; convite que não volta; última pessoa moderando. `frontend/src/pages/Privacy.test.jsx`: baixar o arquivo e excluir com senha errada e certa.
