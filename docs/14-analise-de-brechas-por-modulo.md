# Análise de brechas, módulo por módulo

Data: 29/10/2026 · Versão analisada: `main` após o PR #17.

**Método.** Li o código de cada módulo procurando um caminho concreto de exploração: quem ataca, o que envia e o que ganha. As brechas mais importantes foram confirmadas no app rodando localmente, com contas criadas na hora e poucas requisições. Nenhum teste de carga foi feito, nenhum token foi forjado e nenhum serviço de fora foi tocado.

**Gravidade:**
- **Alta:** dá controle ou acesso que a pessoa não deveria ter.
- **Média:** abuso real com esforço baixo.
- **Baixa:** abuso limitado ou que depende de condições específicas.
- **Info:** não é falha, mas convém saber.

**Status:**
- **Confirmado:** reproduzido localmente.
- **Pelo código:** lido no código, sem reprodução.
- **Conhecido:** já listado em `docs/10`.

## Resumo

| # | Módulo | Brecha | Gravidade | Status |
|---|---|---|---|---|
| M-1 | Moderação | `MODERATORS` promove nome ainda livre: quem cadastrar o nome vira moderação no próximo reinício | **Alta** | Confirmado |
| A-1 | Autenticação | Com `TRUST_PROXY=true`, um `X-Forwarded-For` forjado zera o limite de login: força bruta sem limite | **Alta** (configuração) | Confirmado |
| A-2 | Autenticação | Seed com senha conhecida (`senha1234`) e `ana_dev` moderadora | **Alta** (implantação) | Pelo código |
| C-1 | Canais | Qualquer conta lê as mensagens de qualquer grupo sem entrar nele (REST e tempo real) | Média, Alta se houver grupo privado | Confirmado |
| T-1 | Token | Recompensar post de conta suspensa tira o token da carteira e a tela mostra erro | Média | Confirmado |
| M-2 | Moderação | O recurso de suspensão confirma se a senha está certa e tem um limite próprio, além do do login | Média | Confirmado |
| M-3 | Moderação | O autor apaga o post já removido ou denunciado: some a prova, e um recurso aceito não restaura nada | Média | Confirmado |
| C-2 | Canais | O dono não consegue expulsar nem banir ninguém do grupo | Média | Confirmado |
| C-3 | Canais | Reação aceita qualquer texto e várias por pessoa, cada uma transmitida à sala | Média | Confirmado |
| P-1 | Posts | Menções sem limite: cerca de 50 notificações por post, 300 posts a cada 3 h | Média | Confirmado |
| W-1 | Frontend | Sem proteção contra iframe (clickjacking) | Média (implantação) | Confirmado |
| A-3 | Autenticação | Atrás de proxy sem `TRUST_PROXY`, todos dividem um IP: 20 erros de qualquer pessoa travam o login de todos | Média | Pelo código, conhecido (M4) |
| A-4 | Autenticação | Limite só por IP, não por conta | Média | Conhecido (M4) |
| C-4 | Tempo real | WebSocket sem limite de assinaturas e eventos | Média | Conhecido (M5) |
| T-2 | Token | Contas falsas cumprem missões entre si e juntam NWC numa conta | Média | Conhecido (M6) |
| — | — | Outros 28 achados baixos e informativos | Baixa / Info | Abaixo, em cada módulo |

**O que resistiu:**
- **Injeção de SQL:** todas as consultas são parametrizadas. Os poucos trechos montados no código usam só constantes internas.
- **Acesso a dado de outra pessoa (IDOR):** toda escrita confere o dono ou o papel.
- **JWT:** algoritmo fixo e segredo forte obrigatório.
- **Campos extras no cadastro:** o zod ignora `is_moderator` e afins.
- **XSS no app:** o React escapa o texto e não há HTML injetado.
- **CSRF:** o cookie é `SameSite=Strict` e a API usa token Bearer.
- **Expressões regulares:** as palavras-chave do feed são escapadas.

---

## 1. Autenticação e sessão

Arquivos: `routes/auth.js`, `services/sessions.js`, `lib/auth.js`, `lib/rateLimit.js`, `config.js`.

**A-1 · Alta (configuração) · Confirmado.** `TRUST_PROXY=true` faz o Express confiar em qualquer `X-Forwarded-For`. O limite de login, cadastro, refresh e recurso é contado por `req.ip`. Quem troca o cabeçalho a cada pedido ganha um contador novo.
- Teste local: com `TRUST_PROXY=true`, os IPs forjados 1.1.1.1, 2.2.2.2 e 3.3.3.3 receberam cada um o limite cheio (19 restantes). Na configuração padrão, o cabeçalho é ignorado.
- Correção: aceitar só número de saltos ou lista de IPs e recusar `true` ao iniciar. Junto com A-4, limitar também por conta.

**A-2 · Alta (implantação) · Pelo código.** O seed cria `ana_dev` como moderadora, com a senha `senha1234`, e o README publica o login. Rodar o seed numa instância acessível entrega a moderação a qualquer pessoa.
- Correção: o seed recusa rodar com `NODE_ENV=production` e, fora de testes, gera senha aleatória e a mostra uma vez.

**A-3 · Média · Pelo código, conhecido (M4).** Atrás de nginx ou Caddy sem `TRUST_PROXY`, `req.ip` é o do proxy. Então 20 tentativas erradas de qualquer pessoa em 15 minutos bloqueiam login e cadastro de todo mundo.
- Correção: configurar os saltos do proxy (A-1) e separar os limites de login e de cadastro.

**A-4 · Média · Conhecido (M4).** Não há limite por conta. A senha de uma conta pode ser testada a partir de muitos IPs.
- Correção: contar tentativas por e-mail e atrasar depois de N erros, sem bloquear a dona da conta.

**A-5 · Baixa · Conhecido (M3).** O cadastro responde 409 "Usuário ou e-mail já cadastrado", o que revela quais e-mails têm conta.

**A-6 · Baixa · Pelo código.** O e-mail nunca é confirmado.
- Qualquer pessoa cadastra o e-mail de outra, e a dona real fica impedida de criar a conta.
- O recurso de suspensão identifica a pessoa pelo e-mail.

**A-7 · Baixa · Pelo código.** A revogação de sessão falha aberta:
- `isRevoked` devolve `false` se o Redis der erro;
- sem Redis, a lista de sessões revogadas fica só na memória e some ao reiniciar.

Nesses casos, um token de sessão encerrada volta a valer por até 15 minutos.

**A-8 · Baixa · Pelo código.** Durante 30 segundos depois de cada renovação, o refresh antigo ainda gera um token de acesso. Um refresh roubado e usado nessa janela não aciona a detecção de reuso.

**A-9 · Info.** O cookie `Secure` vem desligado (`COOKIE_SECURE`). Em HTTPS, ligar.

## 2. Usuários, perfis e convites

Arquivos: `routes/users.js`, `services/users.js`, `services/invites.js`.

**U-1 · Baixa · Confirmado.** As listas de seguidores e de quem a conta segue não filtram nada.
- As de contas suspensas continuam públicas.
- Quem foi bloqueado continua vendo as listas de quem bloqueou.

**U-2 · Baixa · Pelo código.** Dá para seguir uma conta suspensa: `follow` só confere bloqueio.

**U-3 · Info.** O nome de exibição aceita qualquer texto, inclusive letras parecidas de outros alfabetos. O selo de moderação protege só esse papel, não a identidade de outras pessoas.

Usuário, e-mail e slug são `CITEXT` (sem duplicata por maiúscula), e os códigos de convite usam 8 caracteres aleatórios. Não achei brecha nesses pontos.

## 3. Posts, timeline e feed "Para você"

Arquivos: `routes/posts.js`, `services/posts.js`, `services/timeline.js`, `services/interests.js`, `routes/feed.js`.

**P-1 · Média · Confirmado.** Um post de 280 caracteres cabe em torno de 50 menções. Cada menção gera notificação em tempo real e entra na aba Menções, e o limite é de 300 posts a cada 3 horas. Uma conta consegue incomodar centenas de pessoas por hora; o bloqueio só vale depois.
- Correção: no máximo cerca de 10 menções por post e um limite de menções por hora.

**P-2 · Baixa · Confirmado.** O bloqueio não protege a leitura. Sem token, os posts de quem bloqueou aparecem em `/api/users/:u/posts`, `/api/posts` e `/federation/users/:u/outbox`. É assim no X para contas públicas, mas o app deveria dizer isso ao bloquear.

**P-3 · Baixa · Pelo código.** A thread mostra só as 500 primeiras respostas. Inundar uma conversa empurra as respostas mais novas para fora.

**P-4 · Baixa · Pelo código.** Dá para responder e curtir post de autor suspenso pelo ID direto. `assertCanInteract` confere só bloqueio.

**P-5 · Info.** IDs Snowflake revelam o momento de criação e permitem enumerar posts públicos em ordem.

O feed "Para você" valida pesos, temas e palavras com zod `strict`, escapa as palavras-chave e tem limite próprio de pedidos. Não achei brecha nele.

## 4. Canais, grupos e tempo real

Arquivos: `routes/channels.js`, `services/channels.js`, `realtime/socket.js`.

**C-1 · Média (Alta se houver grupo privado) · Confirmado.** `listMessages`, `getDifference` e o `channel:subscribe` do WebSocket nunca conferem se quem pede é membro. Uma conta que não entrou no grupo leu o histórico e recebe as mensagens novas ao vivo.
- Hoje qualquer pessoa pode entrar em qualquer grupo, então o efeito é pequeno.
- A interface, porém, fala em "membros", e no dia em que existir grupo fechado ele já nasce aberto para leitura.
- Correção: exigir `viewer_role` para ler e assinar, e criar grupos com convite.

**C-2 · Média · Confirmado.** Não existe expulsar nem banir. O dono de um grupo não tira um assediador; cada pessoa só pode bloqueá-lo para si.
- Correção: `DELETE /:slug/members/:username` para dono e admins, e lista de banidos que impede entrar de novo.

**C-3 · Média · Confirmado.** O campo `emoji` aceita qualquer texto de até 16 caracteres, e uma pessoa pode pôr vários diferentes na mesma mensagem. No teste, a mesma conta pôs três "reações" de texto livre.
- Cada reação é retransmitida para a sala inteira, e reações não podem ser denunciadas.
- Correção: lista fechada de emojis, no máximo 1 a 3 por pessoa e limite de reações por minuto.

**C-4 · Média · Conhecido (M5).** O WebSocket não limita conexões, assinaturas nem eventos, e cada `channel:subscribe` faz uma consulta ao banco.

**C-5 · Baixa · Pelo código.** Criar canal não tem limite próprio, e a lista mostra só os 100 mais novos. Uma conta pode empurrar os outros para fora da lista, e a missão "Abra um espaço" ainda paga 4 NWC por grupo.

**C-6 · Baixa · Pelo código.** O socket continua aberto depois que o token vence. Só cai quando a sessão é encerrada.

**C-7 · Baixa · Conhecido (M5).** `post:deleted` é enviado a todos os conectados.

## 5. Moderação, regras e recursos

Arquivos: `services/moderation.js`, `services/rules.js`, `routes/moderation.js`, `server.js`.

**M-1 · Alta · Confirmado.** `promoteModerators` roda a cada início e promove por nome: `UPDATE users SET is_moderator = true WHERE username = ANY($MODERATORS)`.
- Se um nome da lista ainda não existe, quem cadastrar esse nome vira moderação no próximo reinício.
- No teste, o nome não existia (0 promovidos). Uma conta nova o registrou, foi promovida e abriu a fila da moderação (HTTP 200).
- Correção: promover só por comando explícito, com o id da conta. Ao iniciar, avisar sobre nomes da lista que não existem e não promover contas criadas depois da configuração.

**M-2 · Média · Confirmado.** `/api/recursos/suspensao` responde de forma diferente conforme a senha:
- senha errada: 401;
- senha certa de uma conta não suspensa: 409 "Esta conta não está suspensa".

Isso o torna um segundo lugar para testar senhas, com limite próprio (10 a cada 15 min) somado ao do login (20).
- Correção: mesma resposta para tudo que não for "conta suspensa com senha certa", e um limite compartilhado com o login.

**M-3 · Média · Confirmado.** `deletePost` apaga de vez mesmo um post já removido pela moderação ou com denúncia aberta.
- O autor destrói a prova antes da análise. A denúncia guarda o texto, mas "Remover post" passa a falhar.
- Depois de uma remoção, um recurso aceito não tem o que restaurar.
- Correção: recusar a exclusão com `removed_at` ou denúncia aberta, ou fazer exclusão suave.

**M-4 · Baixa · Pelo código.** A mesma pessoa da moderação pode denunciar e decidir a própria denúncia, ou julgar o recurso contra a própria decisão. Com mais de uma pessoa na moderação, exigir outra.

**M-5 · Baixa · Pelo código.** Contas falsas podem inundar a fila: são 20 denúncias por dia por conta, sem limite de contas, e a fila mostra só 200 por vez.

**M-6 · Info.** Uma conta suspensa pode criar outra na hora. Não há barreira de e-mail confirmado nem de convite (ver A-6).

## 6. Missões e token NWC

Arquivos: `services/tokens.js`, `services/missions.js`, `services/activity.js`, `lib/missions.js`.

**T-1 · Média · Confirmado.** `tipPost` não confere se o autor está suspenso nem se o original de um repost foi removido.
- A transferência acontece, e só a resposta final (`getPost`) dá 404.
- No teste, a carteira registrou `tip_sent -1` e a pessoa viu um erro.
- Correção: conferir suspensão e remoção (do post e do original) antes de transferir.

**T-2 · Média · Conhecido (M6).** Cada conta nova ganha 3 NWC. Várias missões são cumpridas entre contas próprias: convidar, dar boas-vindas, responder pergunta, amplificar. Depois, as recompensas transferem tudo para uma conta principal, até 20 por dia por conta.
- Correção, antes de dar utilidade ao NWC: convites com fila, idade mínima de conta para pagar missões e teto de recebimento.

**T-3 · Baixa · Pelo código.** A missão é verificada quando a pessoa abre a lista e paga uma vez. Depois disso, desfazer não tira o crédito: dá para curtir 5 posts, receber e descurtir; ou seguir, receber e deixar de seguir.

**T-4 · Baixa · Pelo código.** "Tempo no app" aceita um sinal a cada 55 segundos sem verificar a tela. Um script cumpre a missão em 10 minutos.

**T-5 · Baixa · Conhecido (M2, B4).** `GET /api/missoes` grava dados e roda as consultas coletivas pesadas a cada chamada, sem limite próprio.

## 7. Federação

Arquivo: `routes/federation.js`.

**F-1 · Baixa · Pelo código.** O outbox põe o texto do post em `content`, que outras instâncias tratam como HTML. Um servidor remoto que não sanitize mostraria marcação do post. O Mastodon sanitiza, mas o correto é escapar.

**F-2 · Baixa · Pelo código.** As URLs usam `http://` fixo. Em HTTPS, os links ficam inseguros e misturados.

**F-3 · Info.** O outbox não respeita bloqueio (ver P-2).

## 8. Dados oficiais (aba Brasil)

Arquivos: `official/*`, `routes/officialData.js`.

**D-1 · Info.** O risco é baixo:
- o registro é estático e conferido à mão;
- as URLs são fixas no catálogo, então não há SSRF;
- a busca automática vem desligada;
- forçar a atualização é só da moderação, com limite.

Se a busca for ligada, a resposta das fontes é lida sem limite de tamanho. Vale pôr um teto.

## 9. Frontend

Arquivos: `frontend/src`, `vite.config.js`.

**W-1 · Média (implantação) · Confirmado.** A CSP do app vai numa `<meta>`, que não aceita `frame-ancestors`, e o servidor estático não manda `X-Frame-Options`. O `vite preview` não manda nenhum dos dois. Outro site pode pôr o app num iframe e induzir cliques em "Sair de todos os aparelhos", "Recompensar" ou "Bloquear".
- Correção: servir o frontend com `Content-Security-Policy: frame-ancestors 'none'` e `X-Frame-Options: DENY`.

**W-2 · Baixa · Pelo código.** No modo "neste aparelho", as preferências e o aprendizado ficam no `localStorage` depois de sair. Em aparelho compartilhado, a próxima pessoa pode lê-los.

**O que resistiu:**
- o token de acesso fica só na memória;
- o refresh fica em cookie `HttpOnly` com `SameSite=Strict`;
- não há `dangerouslySetInnerHTML`;
- os links são montados com nomes de usuário de alfabeto restrito;
- o cadastro não segue redirecionamento vindo da URL.

## 10. Infraestrutura

**I-1 · Baixa.**
- O padrão de `DATABASE_URL` tem senha conhecida (`social:social`).
- O Redis não exige senha.
- Os dois só valem para uso local; numa rede compartilhada, exigir senhas.

**I-2 · Baixa.** O limite de pedidos usa janela fixa, então dá para fazer o dobro na virada da janela. Sem Redis, cada processo conta sozinho.

## Ordem sugerida de correção

1. **M-1, A-1 e A-2:** são as que dão controle (moderação ou senhas). Exigem pouco código e testes simples.
2. **T-1, M-2 e M-3:** perda de saldo, oráculo de senha e destruição de prova.
3. **C-1, C-2 e C-3:** permissão de leitura, expulsão e reações fechadas.
4. **P-1 e W-1:** limite de menções e cabeçalho contra iframe.
5. **A-3 e A-4, C-4, T-2:** os itens médios já conhecidos do `docs/10`.
6. **O restante:** os itens baixos.

## Correções feitas (pré-produção)

As correções ficam no código do app e nos servidores de desenvolvimento e de pré-visualização. Nada exige mudar a configuração da produção oficial: uma instalação que já esteja no ar continua iniciando como antes. Os testes ficam em `backend/test/brechas.test.js` e `frontend/src/pages/Channel.test.jsx`.

| # | O que mudou |
|---|---|
| M-1 | `MODERATORS` só promove contas que já existem. Um nome ainda livre fica anotado (`moderator_names_missing`), e uma conta criada depois com esse nome não é promovida: o servidor avisa no log. A promoção da pessoa certa é manual: `npm run moderacao:promover -- <usuario>`. |
| A-1 | `TRUST_PROXY=true` impede o servidor de iniciar fora de produção. Em produção, só gera um aviso, para não mudar nada no ar. |
| A-2 | O seed recusa `NODE_ENV=production`, porque apaga o banco. Usa `senha1234` só em domínio local; em qualquer outro, a senha vem de `SEED_PASSWORD` (12 caracteres ou mais) ou é sorteada e mostrada uma vez. |
| T-1 | Não dá mais para interagir com conta suspensa pelo ID direto: recompensar, curtir, responder, repostar, seguir e reagir devolvem 404, e o saldo não sai da carteira. O original removido de um repost também não recebe recompensa. Isso fecha também U-2 e P-4. |
| M-2 | O recurso de suspensão dá a mesma resposta para senha errada, conta inexistente e conta não suspensa, e conta no mesmo limite do login. |
| M-3 | Post com denúncia aberta ou já removido não é mais apagado de vez. Sai do ar, fica marcado como apagado pelo autor (`deleted_by_author_at`), a moderação ainda decide, e um recurso aceito não o traz de volta. Sem denúncia, apagar continua apagando. |
| C-1 | Grupo é só de quem entrou: histórico, `/difference` e assinatura ao vivo exigem ser membro. Canal de transmissão segue com prévia, como no Telegram. Quem sai ou é removido para de receber na hora. |
| C-2 | Dono e admins removem pessoas (`DELETE /api/channels/:slug/members/:usuario`), e quem foi removido não entra de novo até a remoção ser desfeita (`DELETE /api/channels/:slug/bans/:usuario`). Admin não remove outro admin nem o dono. Na tela, o botão "Remover" aparece nas mensagens de outras pessoas. |
| C-3 | Reações só com 8 emojis, no máximo 3 por pessoa em cada mensagem, e limite de 60 por minuto. |
| P-1 | No máximo 10 menções por post. |
| W-1 | Os servidores do Vite (desenvolvimento e `vite preview`) mandam `X-Frame-Options: DENY` e `frame-ancestors 'none'`. **Produção:** o servidor que hospeda o frontend oficial precisa mandar os mesmos dois cabeçalhos; isso não foi alterado aqui. |
| A-4 | Até 10 senhas erradas por conta a cada 15 minutos, contando só os erros. Acertar não gasta tentativa. |
| C-4 | No WebSocket: no máximo 10 conexões por conta, 50 canais por conexão, 30 pedidos de assinatura por minuto, e mensagens de até 16 KB. |
| C-5 | Até 5 canais ou grupos novos por dia por conta. |
| U-1 | Conta suspensa não mostra listas de seguidores; quem tem bloqueio recebe lista vazia; contas escondidas não aparecem. |
| M-4 | Com mais de uma pessoa na moderação, ninguém decide a própria denúncia nem o recurso contra a própria decisão. |
| T-5 | `GET /api/missoes` tem limite próprio (60 a cada 5 minutos). |
| F-1 | O texto do post vai escapado no outbox federado. |
| D-1 | A resposta das fontes oficiais tem teto de 2 MB, quando a busca automática estiver ligada. |

**Não alterado, e por quê:**
- **Dependem da produção oficial:**
  - **A-3:** configurar `TRUST_PROXY` com os saltos do proxy da produção;
  - **A-6:** confirmar e-mail, o que exige um serviço de envio;
  - **A-9:** `COOKIE_SECURE`;
  - **F-2:** HTTPS nas URLs federadas;
  - **I-1:** senhas do Postgres e do Redis da produção;
  - **W-1 na produção:** cabeçalhos do servidor do frontend.
- **Decididos depois, e já feitos (ver a seção seguinte):** T-2, P-2, F-3 e W-2.
- **Baixos, que ficam para depois:**
  - **A-5:** responder o cadastro sem revelar contas atrapalha o uso normal;
  - **A-7 e A-8:** revogação e janela de 30 segundos;
  - **C-6 e C-7:** socket depois de o token vencer e aviso de exclusão para todos;
  - **P-3:** thread com mais de 500 respostas;
  - **T-3 e T-4:** missão desfeita e tempo no app por script;
  - **M-5 e M-6:** fila inundada e conta nova depois de suspensão;
  - **I-2:** janela fixa do limite.

## Decisões do projeto (feitas depois da análise)

| # | Decisão | O que mudou |
|---|---|---|
| T-2 | **O NWC evapora com a inatividade.** | Cada dia sem usar o app leva uma parte do saldo, até zerar em 7 dias. Voltar ao app para a evaporação, e o que evaporou sai de circulação. Detalhes em `docs/09` e `backend/src/services/evaporation.js`. |
| P-2, F-3 | **Posts podem ser vistos sem login, mas não podem ter interação.** | Leitura aberta: timeline, post, thread, perfil, posts do perfil e outbox federado respondem sem login. Interagir (postar, curtir, repostar, responder, recompensar, seguir, silenciar, bloquear, denunciar, apagar, canais e carteira) exige login e responde 401 sem ele; o teste confere que nada é criado nem alterado. No app, quem não entrou vê uma faixa "Você está só lendo", e qualquer botão de interação leva ao login e, depois dele, de volta à mesma página. O bloqueio só vale para quem está logado (sem login, os posts públicos aparecem). |
| W-2 | **O algoritmo fica só no aparelho de cada pessoa e é carregado de lá ao voltar ao app.** | O servidor não guarda nem calcula mais o algoritmo: `/api/feed/interesses` responde 410, `/preferencias` só aceita as opções que não são do algoritmo, e as interações não ensinam nada ao servidor. Sair não apaga o algoritmo do aparelho. Contas antigas: na primeira volta, o app importa o que o servidor tinha (se o aparelho ainda não tiver um algoritmo) e o servidor apaga a cópia. Detalhes em `docs/07` §2.10. |

