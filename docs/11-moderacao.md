# Moderação: silenciar, bloquear e denunciar

**Data:** 28/10/2026 · **Escopo:** backend (`services/relations.js`, `services/moderation.js`, `routes/moderation.js`), frontend (menu "⋯" dos posts e perfis, telas *Bloqueios e denúncias* e *Fila da moderação*).

## 1. Em linguagem simples

Há três ferramentas, para três situações diferentes.

| Ferramenta | Para quando | O que acontece | Quem fica sabendo |
|---|---|---|---|
| **Silenciar** | "Não quero ver isso agora." | Os posts da pessoa somem dos seus feeds, das menções e das notificações. Se você abrir o perfil dela de propósito, os posts continuam lá. | Ninguém. A pessoa não é avisada e nada muda para ela. |
| **Bloquear** | "Não quero contato com essa pessoa." | Vale nos dois sentidos: vocês deixam de ver os posts um do outro, os follows entre vocês são desfeitos e ninguém consegue seguir, responder, curtir, repostar ou recompensar o outro. | A pessoa vê, se abrir o seu perfil, que foi bloqueada. Não recebe aviso. |
| **Denunciar** | "Isso quebra as regras e pode prejudicar outras pessoas." | A denúncia vai para a fila de quem modera a instância, que pode arquivar, remover o post ou suspender a conta. Você acompanha o resultado. | Só a moderação. Quem foi denunciado nunca sabe quem denunciou. |

Silenciar e bloquear resolvem **na hora, para você**. Denunciar pede uma decisão **para todo mundo**. Por isso, depois de denunciar, o app oferece bloquear também.

**Por que existem.** Uma rede aberta só é segura quando cada pessoa consegue se proteger sozinha (silenciar, bloquear) e quando existe alguém responsável por tirar do ar o que é golpe, ameaça ou ódio (denúncia e moderação). Sem isso, golpes e assédio se espalham mais rápido do que as pessoas conseguem reagir. É por isso que a moderação veio antes de abrir o protótipo para outras pessoas.

**Como a moderação decide:**
- **Arquivar:** não viola as regras. Nada acontece com a conta.
- **Remover post:** o post sai do ar para todos. Outras denúncias do mesmo post são resolvidas juntas.
- **Suspender conta:** a conta é desconectada na hora, não consegue mais entrar e os posts somem para todos. Outras denúncias contra a mesma conta são resolvidas juntas. A suspensão pode ser desfeita (reativar).

Toda decisão fica registrada: quem decidiu, quando e com qual nota. Quem denunciou vê o resultado e a nota.

## 2. Regras técnicas

**Filtro num lugar só.** Toda lista de posts passa por `hydrate()` (`services/posts.js`). Lá saem:
- posts e reposts de quem tem bloqueio com quem está vendo, nos dois sentidos;
- posts de contas suspensas, para todos, inclusive visitantes sem login;
- por padrão, posts de quem a pessoa silenciou.

Com `{ muted: false }`, os silenciados aparecem: é o caso do perfil, da thread e de um post aberto diretamente, porque a pessoa escolheu ver.

As consultas que **sugerem** conteúdo também filtram, com o mesmo SQL (`hiddenAuthorsSql`): o feed "Para você" (para não gastar o limite da sessão com posts que seriam escondidos), as sugestões das missões e a busca de pessoas. As missões que dão alcance ("amplificar", "ponte") também não sugerem contas com denúncia aberta.

**Editar não apaga a prova.** Post com denúncia em análise não pode ser editado (como já não pode ser apagado de vez), e toda versão anterior de um post editado fica no histórico público (`GET /api/posts/:id/edicoes`).

**Citar respeita o bloqueio.** Quem tem bloqueio com a autora não consegue citar o post (403), e quem tem bloqueio com a autora do original vê a citação de outra pessoa sem o post citado ("Este post não está disponível").

**Imagens seguem o post.** Post removido pela moderação, apagado ou de conta suspensa para de servir as imagens dele na hora (`GET /api/midia/:id` responde 404); um recurso aceito traz o post e as imagens de volta.

**Notificações seguem as mesmas regras.** Quem silenciou ou tem bloqueio com quem agiu não recebe o aviso (nem em tempo real, nem na tela de notificações). Avisos antigos de quem foi silenciado, bloqueado ou suspenso depois somem da lista e do contador, assim como os de posts apagados ou removidos pela moderação.

**Bloqueio impede interação.** `assertCanInteract()` recusa com 403 os seguintes casos:
- seguir;
- responder;
- curtir;
- repostar (vale o autor do original, mesmo repostando o repost de outra pessoa);
- recompensar com NWC.

**Tempo real.** O aviso de post novo e as notificações de menção e resposta não chegam a quem silenciou ou tem bloqueio com o autor (`filterAudience()`).

**Grupos e canais.** As mensagens seguem as mesmas regras, mas, numa conversa, sumir no meio deixaria buracos:
- **bloqueio (qualquer lado) ou conta suspensa:** a mensagem chega como aviso ("Mensagem oculta por bloqueio" ou "Mensagem de uma conta suspensa"), sem texto, sem autor e sem reações, no mesmo `pts`. Assim a numeração segue contínua e o app não pede `/difference` à toa;
- **silenciado:** o texto vem marcado com `muted: true` e o app mostra recolhido, com "Mostrar". Numa conversa, o contexto pode importar;
- **reações:** não dá para reagir à mensagem de quem tem bloqueio com você (403);
- **tempo real:** cada pessoa inscrita no canal recebe a versão que pode ver.

**Paginação.** A paginação continua pelos IDs originais. Uma página pode vir com menos itens que `max_results` quando algo foi filtrado, mas o `next_token` segue correto. O perfil de alguém com bloqueio responde vazio, com `meta.blocked: true` e sem `next_token`.

**Denúncias** (`reports`):
- **Motivos:** `spam`, `assedio`, `odio`, `violencia`, `golpe` e `outro`. Em `outro`, a explicação é obrigatória.
- **Repost:** denunciar um repost denuncia o original.
- **Cópia do texto:** o texto do post fica copiado na denúncia, para a moderação decidir mesmo se o post sumir.
- **Sem duplicata:** a mesma pessoa não abre duas denúncias iguais enquanto a primeira está aberta (um índice único para posts, outro para contas).
- **Limite:** 20 denúncias por dia por pessoa.
- **Quem denuncia** não pode denunciar a si mesmo e nunca vê qual moderador decidiu.

**Moderação:**
- **Papel:** quem modera tem `users.is_moderator`, conferido no banco a cada pedido (não no token). Tirar o papel vale na hora.
- **Como definir:** com `MODERATORS=usuario1,usuario2` no `.env`, as contas são promovidas ao iniciar. No seed, `ana_dev` modera a instância.
- **Selo público:** o perfil de quem modera mostra o selo "Moderação", como o "staff" do Mastodon.
- **Proteções:** quem modera não pode suspender a si mesmo nem outra conta da moderação.
- **Suspensão:** grava `suspended_at` e o motivo, encerra todas as sessões (`revokeAllSessions`) e faz o login responder 403 "Esta conta foi suspensa pela moderação da instância".

## 3. API

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| POST/DELETE | `/api/users/:username/mute` | logado | Silencia / deixa de silenciar |
| POST/DELETE | `/api/users/:username/block` | logado | Bloqueia / desbloqueia |
| GET | `/api/conta/silenciados`, `/api/conta/bloqueados` | logado | Listas da própria pessoa |
| GET | `/api/denuncias/motivos` | todos | Motivos aceitos |
| POST | `/api/denuncias` | logado | `{ post_id \| username, reason, details? }` |
| GET | `/api/denuncias` | logado | Minhas denúncias e o resultado |
| GET | `/api/moderacao/denuncias?status=aberta\|acatada\|arquivada` | moderação | Fila, com quantas denúncias abertas a conta acumula |
| POST | `/api/moderacao/denuncias/:id/resolver` | moderação | `{ action: arquivar \| remover_post \| suspender, note? }` |
| POST | `/api/moderacao/usuarios/:username/reativar` | moderação | Desfaz uma suspensão |

O perfil (`GET /api/users/:username`) traz `relationship.{blocking, blocked_by, muting}`. Uma conta suspensa responde 404.

## 4. Como foi verificado

- **Backend:** 16 testes novos (`test/moderation.test.js`) cobrindo silenciar, bloquear (em todos os lugares onde aparecem posts), denúncias e as três decisões. Um deles encontrou um bug real, que foi corrigido: remover um post colidia com outra denúncia aberta da mesma pessoa contra a mesma conta.
- **Frontend:** 3 testes novos (`src/components/Moderation.test.jsx`). Um deles também pegou um bug, já corrigido: bloquear depois de denunciar fechava a janela antes da confirmação.
- **Navegador, com o app real:**
  - uma pessoa denuncia a conta de spam do seed e a bloqueia;
  - a moderadora vê 3 denúncias na fila e suspende a conta com uma nota;
  - a conta suspensa recebe 403 ao tentar entrar e some do Explorar;
  - quem denunciou vê "Acatada" com a nota;
  - silenciar pelo feed mostra o aviso com "Desfazer".

## 5. Limites conhecidos e próximos passos

- **Federação:** bloquear ou silenciar uma instância inteira ainda não existe; a federação, por enquanto, é só de leitura.
- **Regras da instância e recursos:** feito em [`docs/12-regras-e-recursos.md`](12-regras-e-recursos.md). As decisões agora citam a regra quebrada e podem ser contestadas.
- **Mais de um servidor:** a queda imediata das sessões da conta suspensa (WebSocket) precisa de Redis Pub/Sub entre processos.
