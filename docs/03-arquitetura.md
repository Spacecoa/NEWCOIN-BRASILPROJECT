# Arquitetura do protótipo Ágora

Ágora é uma rede social **federável** de pesquisa: cada instância é independente (usuários, posts e canais próprios), identifica usuários como `usuario@instancia` e expõe uma camada de leitura compatível em espírito com WebFinger/ActivityPub. O foco é a clareza: um processo Node, um Postgres, um Redis opcional.

## 1. Componentes

```mermaid
flowchart LR
  subgraph Cliente["Navegador — React + Tailwind (Vite)"]
    UI["Páginas<br/>Seguindo · Explorar · Menções<br/>Perfil · Thread · Canais"]
    Store["usePostStore<br/>(posts/usuários normalizados)"]
    Sync["channelSync<br/>(pts, lacunas)"]
    UI --> Store
    UI --> Sync
  end

  subgraph Backend["Backend — Node.js / Express 5"]
    direction TB
    MW["Middlewares<br/>JWT · zod · rate limit"]
    R["Rotas REST<br/>/api/auth · /api/users · /api/posts<br/>/api/timeline · /api/mentions · /api/channels"]
    Fed["Federação (somente leitura)<br/>/.well-known/webfinger · /federation/users/:u/outbox"]
    S["Serviços de domínio<br/>users · posts · timeline · channels"]
    Bus(("Barramento de eventos<br/>(EventEmitter)"))
    RT["Tempo real — Socket.io<br/>salas user:ID e channel:ID"]
    MW --> R --> S
    Fed --> S
    S -- "post:created · message:created<br/>message:reactions · notification" --> Bus --> RT
  end

  PG[("PostgreSQL<br/>fonte da verdade")]
  RD[("Redis<br/>timelines materializadas<br/>+ contadores de rate limit")]
  Other["Outras instâncias Ágora<br/>(futuro)"]

  UI -- "HTTP/JSON (escrita e leitura)" --> MW
  RT -- "WebSocket (push)" --> UI
  S --> PG
  S -. "cache best-effort" .-> RD
  Other -. "WebFinger / outbox" .-> Fed
```

**Princípios:**

1. **Um só caminho de escrita (REST).** O WebSocket só faz *push* do servidor para o cliente. Validação, autorização e rate limit ficam num lugar só.
2. **Postgres é a fonte da verdade, Redis é descartável.** Sem Redis, o sistema dá exatamente o mesmo resultado, só que mais devagar. Os testes rodam a mesma bateria nos dois modos.
3. **Serviços não conhecem o transporte.** Eles emitem eventos num barramento e o módulo Socket.io traduz para salas. Para escalar horizontalmente, troca-se o `EventEmitter` por Redis Pub/Sub (com `@socket.io/redis-adapter`).

### Mapa de código

```
backend/
  sql/schema.sql            tabelas, índices e restrições
  src/app.js                monta Express (rotas + tratamento de erros)
  src/server.js             HTTP + Socket.io + migração
  src/lib/                  snowflake, paginação, auth (JWT/bcrypt), rate limit, erros, menções
  src/services/             regras de negócio (users, posts, timeline, channels)
  src/routes/               camada HTTP fina: valida (zod) → chama serviço → serializa
  src/realtime/             barramento de eventos + Socket.io
  src/seed.js               dados fictícios
  test/                     unitários + integração (Postgres e Redis reais)
frontend/
  src/components/           Feed, PostCard, Composer, Layout, …
  src/pages/                Home, Explore, Mentions, Profile, Thread, Channels, Channel, Login, Register
  src/lib/                  api, socket, usePostStore, thread (árvore), channelSync (pts), time
```

## 2. Modelo de dados

```mermaid
erDiagram
  users ||--o{ posts : escreve
  users ||--o{ follows : "segue (follower)"
  users ||--o{ follows : "é seguido (followee)"
  users ||--o{ likes : curte
  posts ||--o{ likes : recebe
  posts ||--o{ posts : "reply_to_id / repost_of_id"
  posts ||--o{ mentions : contém
  users ||--o{ mentions : "é mencionado"
  users ||--o{ channels : "é dono"
  channels ||--o{ channel_members : tem
  users ||--o{ channel_members : participa
  channels ||--o{ messages : contém
  messages ||--o{ message_reactions : recebe
  users ||--o{ message_reactions : reage

  users {
    bigint id PK "Snowflake"
    citext username UK
    citext email UK
    text password_hash "bcrypt"
    text display_name
    text bio
  }
  follows {
    bigint follower_id PK
    bigint followee_id PK
  }
  posts {
    bigint id PK "Snowflake ⇒ ordem temporal"
    bigint author_id FK
    text text "≤ 280"
    bigint reply_to_id FK "thread"
    bigint repost_of_id FK "repost é um post"
    bigint conversation_id "raiz da thread"
    int like_count
    int reply_count
    int repost_count
  }
  likes {
    bigint user_id PK
    bigint post_id PK
  }
  mentions {
    bigint post_id PK
    bigint user_id PK
  }
  channels {
    bigint id PK
    citext slug UK
    text kind "channel | group"
    bigint owner_id FK
    bigint pts "contador por canal"
  }
  channel_members {
    bigint channel_id PK
    bigint user_id PK
    text role "owner | admin | member"
  }
  messages {
    bigint id PK
    bigint channel_id FK
    bigint author_id FK
    text text "≤ 4096"
    bigint pts "UNIQUE(channel_id, pts)"
  }
  message_reactions {
    bigint message_id PK
    bigint user_id PK
    text emoji PK
  }
```

Decisões importantes:

- **Snowflake gerado na aplicação** (`41 bits ms | 10 bits worker | 12 bits sequência`). Cada instância federada usa um `WORKER_ID` diferente e ninguém precisa de coordenação central. Ordenar por `id` é ordenar por tempo.
- **Contadores desnormalizados** (`like_count` etc.) atualizados na mesma transação da ação. A leitura do feed não faz `COUNT(*)`.
- **Repost como linha em `posts`**, com índice único parcial `(author_id, repost_of_id)`. Ele entra na timeline pelo mesmo caminho de um post comum.
- **`UNIQUE(channel_id, pts)`** garante, no próprio banco, que o `pts` nunca se repete.

## 3. Fluxos principais

### 3.1 Criar post (fan-out na escrita + push em tempo real)

```mermaid
sequenceDiagram
  autonumber
  participant B as Bob (navegador)
  participant API as Express /api/posts
  participant PG as PostgreSQL
  participant RD as Redis
  participant BUS as Barramento
  participant IO as Socket.io
  participant A as Alice (segue Bob)

  B->>API: POST /api/posts {text, reply_to_id?}
  API->>API: JWT · zod (1–280) · rate limit
  API->>PG: BEGIN · SELECT pai FOR UPDATE · reply_count+1<br/>INSERT post · INSERT mentions · COMMIT
  API->>PG: SELECT follower_id WHERE followee_id = Bob
  API->>RD: pipeline: LPUSHX tl:home:ID · LTRIM 0..799 (Bob + seguidores)
  API->>BUS: post:created {post, audience}
  BUS->>IO: emitir em user:ID de cada seguidor
  IO-->>A: timeline:new
  Note over A: aparece "Mostrar 1 post novo"<br/>(não insere automaticamente)
  API-->>B: 201 {data, includes}
  A->>API: GET /api/timeline?since_id=<mais novo que Alice tem>
```

`LPUSHX` só empurra se a lista **já existir**. Assim não se cria uma timeline parcial para quem não abriu o app recentemente: ela é reconstruída inteira na próxima leitura.

### 3.2 Ler a home timeline (cache, reconstrução e fallback)

```mermaid
flowchart TD
  A["GET /api/timeline?until_id&since_id&max_results"] --> R{Redis configurado?}
  R -- não --> SQL["SQL: posts WHERE author_id IN (seguidos ∪ eu)<br/>AND cursores ORDER BY id DESC LIMIT n"]
  R -- sim --> L["LRANGE tl:home:ID 0 -1"]
  L --> E{lista vazia?}
  E -- sim --> RB["Reconstrói pelo SQL (até 800 IDs)<br/>+ sentinela '0' se cobrir todo o histórico<br/>EXPIRE 1h"] --> F
  E -- não --> F["Filtra por cursores (BigInt) e corta em n"]
  F --> C{"página cheia<br/>ou lista completa (sentinela)?"}
  C -- sim --> H
  C -- não --> FB["Completa via SQL a partir<br/>do ID mais antigo em cache"] --> H
  SQL --> H["Hidratação: posts por ID + referenciados<br/>+ autores → {data, includes, meta}"]
  H --> OUT["IDs apagados somem naturalmente<br/>(não são encontrados no SQL)"]
```

Invalidação: seguir ou deixar de seguir faz `DEL tl:home:<seguidor>`. Apagar um post não mexe no cache, porque a hidratação descarta o ID ausente.

### 3.3 Mensagem em canal com detecção de lacuna (`pts`)

```mermaid
sequenceDiagram
  autonumber
  participant A as Alice
  participant API as API
  participant PG as PostgreSQL
  participant IO as Socket.io
  participant B as Bruno (inscrito, lastPts=41)

  B->>IO: channel:subscribe {slug} (ack com pts atual)
  A->>API: POST /api/channels/cafe/messages {text}
  API->>PG: BEGIN · UPDATE channels SET pts=pts+1 RETURNING pts (=42)<br/>INSERT message(pts=42) · COMMIT
  API-->>A: 201 {data: {pts: 42}}
  API->>IO: message:new → sala channel:ID
  IO-->>B: message:new (pts 42)
  Note over B: 42 = 41+1 → anexa
  Note over B: a conexão cai e as mensagens 43–45 são perdidas
  B->>IO: reconecta → channel:subscribe (ack pts=45)
  Note over B: 45 > 42 → lacuna
  B->>API: GET /api/channels/cafe/difference?pts=42
  API-->>B: {data:[43,44,45], meta:{pts:45, too_long:false}}
```

### 3.4 Autenticação

Cadastro com `username`, `email` e `password` (≥ 8, bcrypt com custo 10). Login por e-mail **ou** username, com a mesma mensagem de erro para "não existe" e "senha errada" (evita descobrir contas). O JWT (HS256, 7 dias) vai no header `Authorization: Bearer`, e o Socket.io valida o mesmo token no handshake.

## 4. API (resumo)

Formato de lista: `{ data: [...], includes: { users, posts }, meta: { result_count, newest_id, oldest_id, next_token } }`. Paginação: `since_id`, `until_id` (alias `max_id`) e `max_results` (1–100).

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/auth/register` | — | Cria a conta e devolve `{token, user}` |
| POST | `/api/auth/login` | — | `{login, password}` → `{token, user}` |
| GET | `/api/auth/me` | ✔ | Usuário atual |
| GET | `/api/timeline` | ✔ | Home "Seguindo" (cronológica reversa) |
| GET | `/api/mentions` | ✔ | Posts que mencionam o usuário |
| GET | `/api/posts` | opc. | Timeline pública da instância |
| POST | `/api/posts` | ✔ | `{text, reply_to_id?}` → post criado + autor |
| GET | `/api/posts/:id` | opc. | Post hidratado |
| GET | `/api/posts/:id/thread` | opc. | Conversa inteira (`meta.focal_id`) |
| DELETE | `/api/posts/:id` | ✔ | Apaga (só o autor) |
| POST/DELETE | `/api/posts/:id/like` | ✔ | Curtir / descurtir |
| POST/DELETE | `/api/posts/:id/repost` | ✔ | Repostar / desfazer |
| GET | `/api/users?q=` | — | Busca |
| GET | `/api/users/:username` | opc. | Perfil + métricas + relação |
| GET | `/api/users/:username/posts?exclude=replies,reposts` | opc. | Posts do usuário |
| GET | `/api/users/:username/followers` · `/following` | — | Listas |
| POST/DELETE | `/api/users/:username/follow` | ✔ | Seguir / deixar de seguir |
| GET/POST | `/api/channels` | ✔ | Listar / criar `{slug, title, kind}` |
| GET | `/api/channels/:slug` | ✔ | Detalhes + papel do usuário |
| POST | `/api/channels/:slug/members` | ✔ | Entrar |
| DELETE | `/api/channels/:slug/members/me` | ✔ | Sair |
| PUT | `/api/channels/:slug/members/:username/role` | ✔ dono | Promover/rebaixar admin |
| GET | `/api/channels/:slug/messages` | ✔ | Histórico paginado |
| GET | `/api/channels/:slug/difference?pts=N` | ✔ | Mensagens com pts > N |
| POST | `/api/channels/:slug/messages` | ✔ | Enviar (regras de `kind`/papel) |
| POST | `/api/channels/:slug/messages/:id/reactions` | ✔ | `{emoji}` |
| DELETE | `/api/channels/:slug/messages/:id/reactions/:emoji` | ✔ | Remover reação |
| GET | `/api/feed/interesses` | ✔ | Feed "Para você" do algoritmo aberto, com explicação por post |
| GET/PUT | `/api/feed/preferencias` | ✔ | Preferências do algoritmo e o que ele aprendeu |
| DELETE | `/api/feed/aprendizado` | ✔ | Apaga o aprendizado |
| POST | `/api/posts/:id/feedback` | ✔ | `{kind: "more" \| "less"}` |
| GET | `/api/feed/algoritmo` | — | Especificação pública do algoritmo |
| GET | `/.well-known/webfinger?resource=acct:u@dominio` | — | Descoberta federada |
| GET | `/federation/users/:u` · `/outbox` | — | Ator e últimos posts (ActivityStreams) |

**Eventos Socket.io (servidor → cliente):** `timeline:new`, `notification` (`mention` ou `reply`), `post:deleted`, `message:new`, `message:reactions`. **Cliente → servidor:** `channel:subscribe` (com ack `{ok, pts}`) e `channel:unsubscribe`.

## 5. Caminho para federação completa (não implementado)

O protótipo já tem as **pré-condições**: IDs sem coordenação central (Snowflake com worker por instância), handles `usuario@dominio`, WebFinger e um outbox público. Para federar de verdade faltaria:

```mermaid
sequenceDiagram
  participant A as Instância A (alice@a)
  participant B as Instância B (bob@b)
  Note over A: alice segue bob@b
  A->>B: GET /.well-known/webfinger?resource=acct:bob@b
  B-->>A: link para o ator
  A->>B: POST /federation/users/bob/inbox  Follow (assinado com HTTP Signatures)
  B-->>A: Accept (para o inbox de alice)
  Note over B: bob publica
  B->>A: POST inbox compartilhado  Create(Note) — fan-out entre servidores
  A->>A: guarda cópia remota + LPUSHX nas timelines locais
```

Itens necessários: chaves por ator e assinatura HTTP; `inbox` com fila e reentrega com backoff; tabela de posts e atores remotos; política de moderação e bloqueio por domínio; deduplicação por URI. Em vez de ActivityPub, pode-se avaliar AT Protocol (repositórios assinados por usuário e *relays*) ou Nostr (eventos assinados e relays simples).

## 6. Escalabilidade: o que mudaria

| Gargalo | Hoje | Próximo passo |
|---|---|---|
| Fan-out de contas grandes | Push para todos os seguidores | Híbrido: acima de N seguidores, mesclar na leitura (como o X) |
| Barramento | `EventEmitter` em processo | Redis Pub/Sub ou NATS + `@socket.io/redis-adapter` |
| Fan-out síncrono | Dentro da requisição | Fila (BullMQ ou Kafka) com workers |
| Mídia | — | Upload direto ao objeto (S3/MinIO) com URL assinada, CDN e download em pedaços (como `upload.getFile`) |
| Busca | `ILIKE` | Postgres FTS ou OpenSearch |
| Contadores quentes | `UPDATE … +1` | Contadores no Redis com *flush* periódico |
