# Relatório de análise comparativa

**X/Twitter (feed e threads) × Telegram (canais e mensageria) × protótipo Ágora**

## 1. Resumo

O X e o Telegram resolvem problemas diferentes com a mesma ferramenta básica: **IDs ordenáveis no tempo e cursores**. O X otimiza a *leitura em massa de um grafo assimétrico* (muitas pessoas lendo a mesma timeline montada de muitas fontes). O Telegram otimiza a *entrega confiável e ordenada* de mensagens dentro de uma "caixa" (chat ou canal), com recuperação de lacunas.

O protótipo junta os dois: o **feed** segue o modelo do X (Snowflake, fan-out na escrita, `data`/`includes`) e os **canais** seguem o modelo do Telegram (`pts` por canal, broadcast vs. grupo, sincronização de diferenças). Ambos usam a mesma infraestrutura (Postgres, Redis, Socket.io).

## 2. Comparação lado a lado

| Dimensão | X/Twitter | Telegram | Ágora (protótipo) |
|---|---|---|---|
| **Unidade de conteúdo** | Post (até 280; repost e reply também são posts) | Mensagem dentro de um chat ou canal | Post (feed) e Mensagem (canal) |
| **Grafo** | Assimétrico (seguir) | Associação a chats e canais | Os dois: `follows` e `channel_members` |
| **IDs** | Snowflake global de 64 bits | `msg_id` de sessão (≈ tempo·2³²); `id` de mensagem sequencial **por canal** | Snowflake global + `pts` sequencial por canal |
| **Paginação** | `since_id` / `until_id` / `pagination_token` | `offset_id` / `min_id` / `max_id` / `limit ≤ 100` + `hash` | `since_id` / `until_id` / `max_results` em tudo |
| **Montagem do feed** | Fan-out na escrita em caches de ~800 IDs; híbrido para contas grandes; "Para você" ranqueado | Não há feed agregado: cada canal é uma caixa ordenada | Fan-out na escrita (Redis, 800, reconstrução preguiçosa) + fallback SQL |
| **Tempo real** | Push/streaming, aviso "Mostrar N posts" | Updates pela conexão persistente, com `pts`/`qts`/`seq` | Socket.io: `timeline:new` (aviso) e `message:new` (anexa) |
| **Consistência / lacunas** | Eventual; o usuário puxa com `since_id` | Forte por caixa: `pts` + `getChannelDifference` | Feed eventual; canal com `pts` sem buracos (lock de linha) |
| **Threads** | `conversation_id` + `in_reply_to` | Respostas (`reply_to`) e tópicos ou comentários em canais | `conversation_id` + `reply_to_id`, árvore no cliente |
| **Permissões** | Público por padrão, `reply_settings` | Broadcast (só admins) vs. supergrupo (todos), papéis de admin | `kind` + `owner/admin/member` |
| **Reações** | Like (binário) | Várias reações por mensagem, com `chosen_order` | Like no feed; emojis com `reacted` nos canais |
| **Autenticação** | OAuth 2.0 (PKCE) / OAuth 1.0a para terceiros | Telefone + código + SRP (2FA); a sessão é a `auth_key` | E-mail ou usuário + senha (bcrypt) + JWT |
| **Rate limit** | Cabeçalhos `x-rate-limit-*` + 429 | `FLOOD_WAIT_X` (esperar X s) | Cabeçalhos `x-rate-limit-*` + 429 + `retry_after` |
| **Formato da resposta** | `data` + `includes` + `meta` | Objetos TL com vetores de `users`/`chats` anexos | `data` + `includes` + `meta` |

Um padrão comum chama atenção: **as duas plataformas devolvem entidades relacionadas em vetores separados** (`includes.users` no X; `users`/`chats` em `messages.Messages` no Telegram) em vez de aninhar o autor em cada item. É a mesma normalização, e o protótipo adotou isso no servidor e no cliente (`usePostStore`).

## 3. O que aprendemos com o X (feed e threads) e onde foi aplicado

| Aprendizado | Por que importa | Onde está |
|---|---|---|
| **Snowflake** torna ID igual a tempo | Cursores estáveis, sem `ORDER BY created_at` e sem coordenação entre instâncias | `backend/src/lib/snowflake.js` (+ 6 testes) |
| **Cursor exclusivo (`until_id`) em vez de offset** | Sem duplicatas quando chegam posts novos durante a rolagem | `lib/pagination.js`; teste "pagina com until_id sem duplicar nem pular" |
| **Fan-out na escrita com teto** | Leitura O(1) com cache; o teto limita memória e explica o limite de ~800 da API | `services/timeline.js` |
| **Repost é um post** | Um único caminho de distribuição; métricas no original; repost de repost aponta ao original | `services/posts.js#repost` |
| **`conversation_id`** | Busca a thread inteira com um índice, sem recursão | `posts_conversation_idx`, `getThread()` |
| **`data` + `includes`** | Payload menor e cliente normalizado (curtir atualiza todas as aparições) | `hydrate()`, `usePostStore` |
| **"Mostrar N posts" em vez de inserir** | Não desloca o que a pessoa está lendo | `Feed.jsx` (`pending` + `since_id`) |
| **Rate limit como contrato** | O cliente sabe quando pode tentar de novo | `lib/rateLimit.js` |

## 4. O que aprendemos com o Telegram (canais e mensageria) e onde foi aplicado

| Aprendizado | Por que importa | Onde está |
|---|---|---|
| **Canal e grupo como o mesmo objeto** com flag de modo | Um só armazenamento e código; muda só a regra de quem publica | `channels.kind`, `canPost()` |
| **`pts` por caixa** | O cliente detecta, de forma determinística, que perdeu algo | `channels.pts`, `UNIQUE(channel_id, pts)` |
| **`getChannelDifference` / `TooLong`** | A reconexão busca só o que faltou; se for demais, recarrega | `/difference`, `applyIncoming`, `applyDifference` |
| **Push pela conexão já aberta** | Latência baixa sem polling | `realtime/socket.js`, salas `channel:<id>` |
| **Reações agregadas + marcação pessoal** | Payload compartilhado igual para todos; o estado pessoal fica no cliente | `reactionsFor()`, `mergeReactions()` |
| **`FLOOD_WAIT`** | Proteção explícita contra spam no canal | `messageLimiter` (30/min) |

## 5. O que ficou deliberadamente de fora

| Item | Motivo |
|---|---|
| Timeline "Para você" baseada em engajamento | Substituída por um algoritmo **aberto** de interesses declarados (ver [`07-atencao-e-algoritmo-aberto.md`](07-atencao-e-algoritmo-aberto.md)) |
| Mídia, quotes, enquetes, edição | Imagens entraram (até 4 por post, com descrição obrigatória e sem metadados; ver `docs/10` §4.14), no formato `media[]` com `alt`, como o `includes.media` do X. Vídeo, quotes, enquetes e edição seguem fora do escopo |
| Cliente MTProto ou uso da API real do Telegram | Desnecessário para aprender o desenho, e evitaria qualquer risco de violar os ToS |
| Federação server-to-server | Exige assinatura HTTP, inbox e moderação. Só as pré-condições foram implementadas |
| Criptografia ponta a ponta (chats secretos) | Outra área de estudo (Signal Protocol / MTProto E2E) |

## 6. Resultados

- **Backend:** 50 testes (unitários + integração com Postgres e Redis reais), cobrindo autenticação, posts, threads, likes, reposts, menções, perfis, timeline em **três modos** (Redis, Redis com cache pequeno forçando fallback, sem Redis), canais (permissões, `pts` sob concorrência, `difference`, reações), Socket.io, federação e rate limit.
- **Frontend:** 20 testes (Feed com paginação por cursor, repost, like; Composer com limite de 280 e reply; tempo relativo; árvore de thread; sincronização por `pts`).
- **Ponta a ponta (Playwright, manual):** login, feed, aviso "Mostrar 1 post novo" disparado por outro usuário, like, reply na thread, mensagem em canal entregue em tempo real a outro usuário, layout de 390 px sem rolagem horizontal, nenhum erro no console.

## 7. Conclusões

1. **A ordem temporal está no ID, não numa coluna de data.** As duas plataformas chegaram a isso por caminhos diferentes, e é o que permite cursores baratos e federação sem coordenação.
2. **Feed e mensageria pedem garantias diferentes.** No feed, uma consistência eventual com "puxe o que é novo" é aceitável. No chat, perder uma mensagem não é. O `pts` resolve isso com um contador e uma consulta.
3. **Cache como otimização, nunca como verdade.** O fan-out no Redis só funciona bem porque qualquer lista pode ser jogada fora e reconstruída. Os testes provam que o resultado é igual com e sem cache.
4. **Normalizar a resposta (`includes`) simplifica tanto o servidor quanto o cliente.**

Próximos passos recomendados: fan-out híbrido para contas grandes, fila assíncrona para o fan-out, adapter Redis para o Socket.io com várias instâncias e, por fim, federação real (ActivityPub ou AT Protocol).
