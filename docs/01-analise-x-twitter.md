# Fase 1 — Análise de comportamento e arquitetura do X/Twitter

> **Escopo.** Esta análise usa apenas comportamento observável no produto, a documentação pública da X API v2 e material de engenharia que a própria empresa publicou (posts de blog, palestras, o repositório `the-algorithm` aberto em 2023). Nenhum código proprietário foi extraído, nenhum endpoint privado foi chamado e nenhum scraping foi feito. Valores numéricos (limites, tamanhos) mudam com frequência e com o plano de acesso. Confira sempre em `developer.x.com` antes de usar algum deles como referência.

## 1. Fluxos de usuário mapeados

| Fluxo | Comportamento observado | Como o protótipo reproduz |
|---|---|---|
| **Home "Seguindo"** | Posts e reposts de quem você segue e os seus, em ordem cronológica reversa, sem ranking. Posts novos **não** são inseridos automaticamente: aparece um aviso "Mostrar N posts" no topo. | `GET /api/timeline` + banner "Mostrar N posts novos" que busca com `since_id` |
| **Home "Para você"** | Ranqueada por modelo de recomendação, mistura contas que você segue e contas que não segue. | **Fora do escopo** (ver §5) |
| **Thread / conversa** | Clicar num post mostra os posts "acima" (ancestrais) e as respostas abaixo, em árvore. Todos compartilham um `conversation_id`. | `GET /api/posts/:id/thread` + `buildThread()` no cliente |
| **Menções** | Aba de notificações com posts que citam `@você`. | `GET /api/mentions` + evento `notification` em tempo real |
| **Perfil** | Cabeçalho (nome, @handle, bio, contagens), abas "Posts" (sem respostas) e "Respostas". | `GET /api/users/:username` + `/posts?exclude=replies` |
| **Like** | Alterna, idempotente, contador atualiza na hora. | `POST/DELETE /api/posts/:id/like` |
| **Repost** | Aparece na timeline dos seus seguidores com o cabeçalho "Fulano repostou". Repostar um repost conta no original. | Repost = post com `repost_of_id` (mesmo modelo da API) |
| **Reply** | Cria um post com "Em resposta a @fulano" e incrementa o contador do pai. | `POST /api/posts { text, reply_to_id }` |

## 2. Endpoints públicos da X API v2 que sustentam esses fluxos

| Endpoint | Fluxo | Observações da documentação |
|---|---|---|
| `GET /2/users/:id/timelines/reverse_chronological` | Home "Seguindo" | Exige contexto de usuário (OAuth 2.0 PKCE ou OAuth 1.0a) e `:id` precisa ser o usuário autenticado. Documentado como limitado aos ~800 posts mais recentes. Aceita `exclude=replies,retweets`. |
| `GET /2/users/:id/tweets` | Aba de posts do perfil | Documentado como limitado aos 3.200 posts mais recentes (menos com `exclude=replies`). |
| `GET /2/users/:id/mentions` | Menções | Documentado como limitado aos ~800 mais recentes. |
| `GET /2/tweets/:id` e `GET /2/tweets?ids=` | Detalhe do post | Hidratação por ID, com `expansions`. |
| `GET /2/tweets/search/recent?query=conversation_id:<id>` | Thread | A API não tem um endpoint de "thread": a conversa é reconstruída buscando pelo `conversation_id` (busca recente cobre ~7 dias). |
| `POST /2/tweets` (`reply.in_reply_to_tweet_id`) | Criar post / reply | |
| `POST /2/users/:id/likes`, `DELETE /2/users/:id/likes/:tweet_id` | Like | |
| `POST /2/users/:id/retweets`, `DELETE …/retweets/:source_tweet_id` | Repost | |
| `POST /2/users/:id/following`, `DELETE …/following/:target_user_id` | Seguir | |
| `GET /2/users/by/username/:username`, `GET /2/users/:id/followers`, `…/following` | Perfil e listas | |

A partir de 2023 a documentação passou a dizer "post" em vez de "tweet", mas os caminhos e nomes de campo continuam `tweets`.

## 3. Paginação e limites

### 3.1 Parâmetros

| Parâmetro | Semântica | No protótipo |
|---|---|---|
| `max_results` | Tamanho da página (timelines: 1–100 ou 5–100, dependendo do endpoint). | `max_results` (1–100, padrão 20) |
| `since_id` | Só itens com ID **maior** que este (exclusivo). Usado para "o que chegou de novo". | idem |
| `until_id` | Só itens com ID **menor** que este (exclusivo). | idem; `max_id` aceito como alias |
| `start_time` / `end_time` | Janela por data (ISO 8601). | não implementado; `dateToSnowflake()` mostra como converter data em cursor |
| `pagination_token` | Token opaco tirado de `meta.next_token` / `meta.previous_token`. | `meta.next_token` (aqui é o próprio `oldest_id`, documentado como opaco) |

**`max_id` vs `until_id`.** O enunciado fala em `max_id`, que é da API v1.1 e era *inclusivo*. A v2 trocou por `until_id`, que é *exclusivo*. Isso tira o "−1" manual que clientes v1.1 precisavam fazer para não repetir o último item. O protótipo segue a v2 e aceita `max_id` só como alias didático, com a semântica exclusiva.

**Bloco `meta`** devolvido pela v2: `result_count`, `newest_id`, `oldest_id`, `next_token` e às vezes `previous_token`. O protótipo devolve os quatro primeiros.

### 3.2 Por que cursor e não offset

Os IDs do X são **Snowflakes**: 64 bits = 41 bits de milissegundos desde um epoch próprio (1288834974657, nov/2010) + 10 bits de máquina + 12 bits de sequência. Por isso **ordenar por ID é ordenar por tempo**, e um cursor `until_id` continua estável mesmo com posts novos chegando no topo. Com offset/página, cada post novo empurraria os itens e causaria duplicatas na rolagem. IDs passam de 2^53, então a API também os entrega como **string** (`id_str` na v1.1, `id` string na v2). O protótipo faz o mesmo.

### 3.3 Limites de requisição (valores históricos da documentação)

| Endpoint | Limite documentado (por usuário, janela de 15 min) |
|---|---|
| reverse_chronological | 180 |
| users/:id/tweets | 900 (1.500 por app) |
| users/:id/mentions | 180 (450 por app) |
| POST /2/tweets | historicamente 200 por 15 min por usuário, e um teto diário/3h por conta somando posts e reposts |

Desde 2023 o acesso é dividido em planos (Free, Basic, Pro, Enterprise, e mais tarde pagamento por uso), com limites muito diferentes entre eles. **Os números acima servem só como ordem de grandeza.**

O contrato de limite é comunicado por cabeçalhos: `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset` (epoch em segundos), e HTTP 429 ao exceder. O protótipo implementa exatamente esses cabeçalhos (`src/lib/rateLimit.js`).

## 4. Estrutura de dados de um Post (schema público v2)

```jsonc
{
  "id": "1460323737035677698",          // Snowflake, string
  "text": "…",                          // até 280 "caracteres ponderados"; posts longos usam note_tweet
  "author_id": "2244994945",            // expansions=author_id → includes.users
  "created_at": "2021-11-15T19:08:05.000Z",
  "conversation_id": "1460323737035677698", // id do post raiz da thread
  "in_reply_to_user_id": "…",
  "referenced_tweets": [ { "type": "replied_to" | "quoted" | "retweeted", "id": "…" } ],
  "public_metrics": { "retweet_count": 0, "reply_count": 0, "like_count": 0,
                      "quote_count": 0, "bookmark_count": 0, "impression_count": 0 },
  "attachments": { "media_keys": ["3_…"], "poll_ids": ["…"] }, // expansions → includes.media
  "entities": { "mentions": [{ "start": 0, "end": 8, "username": "…", "id": "…" }],
                "hashtags": [], "urls": [], "cashtags": [] },
  "edit_history_tweet_ids": ["…"],
  "lang": "pt", "possibly_sensitive": false, "reply_settings": "everyone"
}
```

Mídia (`includes.media[]`): `media_key`, `type` (`photo` | `video` | `animated_gif`), `url` ou `preview_image_url`, `width`, `height`, `duration_ms`, `alt_text`, `variants` (para vídeo).

**Padrão de resposta.** A resposta separa `data` (os itens pedidos) de `includes` (objetos referenciados: `users`, `tweets`, `media`, `polls`), e você escolhe o que vem com `expansions` e `*.fields`. Isso evita repetir o mesmo autor em cada post de uma página e foi reproduzido no protótipo (`includes.users` e `includes.posts`).

### Mapeamento para o modelo do protótipo

| X API v2 | Ágora | Nota |
|---|---|---|
| `id` (Snowflake) | `id` (Snowflake, epoch 2024-01-01) | mesmo layout de bits |
| `referenced_tweets[type=replied_to]` | `referenced_posts[type=replied_to]` + `in_reply_to_post_id` | |
| `referenced_tweets[type=retweeted]` | `referenced_posts[type=reposted]` | repost é um post |
| `referenced_tweets[type=quoted]` | — | quote fora do escopo |
| `public_metrics` | `public_metrics` (like, reply, repost) | contadores desnormalizados |
| `entities.mentions` | tabela `mentions` | extraída no momento da escrita |
| — | `viewer.{liked,reposted}` | a v2 não expõe isso no objeto. O cliente oficial obtém por outras chamadas; aqui vem embutido. |

## 5. Arquitetura inferida (a partir de material público)

1. **Home timeline com fan-out na escrita.** Palestras de engenharia do Twitter (por exemplo, "Timelines at Scale", QCon 2013) descrevem que cada post é empurrado para uma lista em cache (Redis) de cada seguidor, limitada a algumas centenas de IDs (~800). Ler a timeline vira "pegar IDs do cache + hidratar". Esse é o motivo do teto de ~800 posts no endpoint reverse_chronological.
2. **Exceção para contas enormes.** Empurrar um post para dezenas de milhões de listas é caro. Por isso, contas com muitos seguidores são mescladas **na leitura** (modelo híbrido).
3. **Hidratação separada.** As listas guardam só IDs. Conteúdo, autor e métricas vêm de serviços próprios, e por isso a API também separa `data` de `includes`.
4. **"Para você".** O código aberto em 2023 (`twitter/the-algorithm`) descreve um pipeline com: busca de candidatos dentro da rede (grafo de interação) e fora dela (embeddings como SimClusters/TwHIN), depois ranqueamento por rede neural, depois filtros e heurísticas. É deliberadamente **fora do escopo** deste protótipo, que busca o feed cronológico transparente.

## 6. O que levamos para o protótipo

- Snowflake + cursores `since_id`/`until_id` + `meta.next_token`.
- `data` + `includes` na resposta e store normalizado no cliente.
- Repost como post, `conversation_id` para threads.
- Fan-out na escrita em listas Redis com teto de 800 e reconstrução preguiçosa. Fallback para SQL.
- UX de "Mostrar N posts novos" em vez de inserção automática.
- Cabeçalhos de rate limit idênticos aos da API.
