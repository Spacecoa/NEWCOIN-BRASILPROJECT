-- Ágora — schema do protótipo (PostgreSQL 14+)
-- IDs são "Snowflakes" de 64 bits gerados na aplicação (ver src/lib/snowflake.js).
-- Por serem ordenados no tempo, permitem paginação por cursor (since_id / until_id)
-- exatamente como a API do X faz com IDs de posts.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,
  username      CITEXT NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  display_name  TEXT   NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  bio           TEXT   NOT NULL DEFAULT '' CHECK (char_length(bio) <= 160),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grafo social assimétrico (modelo X): seguir não exige reciprocidade.
CREATE TABLE IF NOT EXISTS follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id, follower_id);

-- Um "post" segue o modelo do X v2: repost também é um post (referenced_tweets.type = retweeted)
-- e replies carregam conversation_id (id do post raiz da thread).
CREATE TABLE IF NOT EXISTS posts (
  id              BIGINT PRIMARY KEY,
  author_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text            TEXT   NOT NULL DEFAULT '' CHECK (char_length(text) <= 280),
  reply_to_id     BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  repost_of_id    BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL,
  like_count      INTEGER NOT NULL DEFAULT 0,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  repost_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um post é texto OU repost, nunca ambos vazios.
  CHECK (repost_of_id IS NOT NULL OR char_length(text) > 0),
  CHECK (repost_of_id IS NULL OR reply_to_id IS NULL)
);
CREATE INDEX IF NOT EXISTS posts_author_idx       ON posts (author_id, id DESC);
CREATE INDEX IF NOT EXISTS posts_conversation_idx ON posts (conversation_id, id);
CREATE INDEX IF NOT EXISTS posts_reply_to_idx     ON posts (reply_to_id);
-- Um usuário só pode repostar o mesmo post uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS posts_unique_repost ON posts (author_id, repost_of_id)
  WHERE repost_of_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS likes (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS likes_post_idx ON likes (post_id);

-- Menções extraídas do texto (@username) no momento da escrita — equivalente a entities.mentions.
CREATE TABLE IF NOT EXISTS mentions (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS mentions_user_idx ON mentions (user_id, post_id DESC);

-- Vertente Telegram: "channel" = broadcast (só admins publicam), "group" = todos os membros publicam.
CREATE TABLE IF NOT EXISTS channels (
  id          BIGINT PRIMARY KEY,
  slug        CITEXT NOT NULL UNIQUE CHECK (slug ~ '^[A-Za-z0-9_]{3,32}$'),
  title       TEXT   NOT NULL CHECK (char_length(title) BETWEEN 1 AND 64),
  description TEXT   NOT NULL DEFAULT '' CHECK (char_length(description) <= 255),
  kind        TEXT   NOT NULL CHECK (kind IN ('channel', 'group')),
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Contador monotônico por canal, inspirado no "pts" do MTProto: permite ao cliente
  -- detectar lacunas (gaps) após uma reconexão.
  pts         BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT   NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS channel_members_user_idx ON channel_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT   NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4096),
  pts        BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, pts)
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id, id DESC);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT   NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------------------
-- Algoritmo de atenção aberto ("Interesses") — ver src/lib/ranking.js
-- ---------------------------------------------------------------------------

-- Preferências declaradas (pesos, tópicos, palavras-chave, limites). JSON validado pela API.
CREATE TABLE IF NOT EXISTS feed_settings (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings   JSONB  NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O que foi aprendido com ações explícitas. Decai com o tempo (meia-vida de 14 dias),
-- é visível ao usuário e pode ser apagado a qualquer momento.
CREATE TABLE IF NOT EXISTS learned_topics (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic      TEXT   NOT NULL,
  value      REAL   NOT NULL CHECK (value BETWEEN -1 AND 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic)
);

CREATE TABLE IF NOT EXISTS learned_authors (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value      REAL   NOT NULL CHECK (value BETWEEN -1 AND 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, author_id)
);

-- "Menos disto": o post some do feed de interesses dessa pessoa.
CREATE TABLE IF NOT EXISTS hidden_posts (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ---------------------------------------------------------------------------
-- Missões diárias de organização popular — ver src/lib/missions.js
-- A conclusão de cada missão é DERIVADA das ações reais (posts, follows,
-- mensagens, convites); não há pontos nem sequências armazenados.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_skips (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE   NOT NULL,
  mission    TEXT   NOT NULL,
  PRIMARY KEY (user_id, day, mission)
);

-- Convites: crescimento de pessoa para pessoa.
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9]{8}$'),
  inviter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_by    BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invites_inviter_idx ON invites (inviter_id);

-- ---------------------------------------------------------------------------
-- Token interno (NewCoin) — ver src/services/tokens.js e docs/09-token-interno.md
-- Sem valor monetário, sem conversão, sem saída do app. Só nasce de missões
-- concluídas; recompensas entre pessoas apenas TRANSFEREM saldo existente.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS token_balances (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extrato imutável: o saldo é sempre a soma do extrato (verificado nos testes).
CREATE TABLE IF NOT EXISTS token_ledger (
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount <> 0),
  kind       TEXT NOT NULL CHECK (kind IN ('grant', 'mission', 'tip_sent', 'tip_received')),
  ref        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS token_ledger_user_idx ON token_ledger (user_id, id DESC);

-- Uma recompensa por missão, por pessoa, por dia (idempotência garantida pelo banco).
CREATE TABLE IF NOT EXISTS mission_rewards (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE   NOT NULL,
  mission    TEXT   NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, mission)
);

-- Recompensa entre pessoas: como um like, uma por post por pessoa.
CREATE TABLE IF NOT EXISTS tips (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL DEFAULT 1 CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tip_count INTEGER NOT NULL DEFAULT 0;

-- Tempo ativo no app (só minutos agregados por dia; nunca usado no ranking).
CREATE TABLE IF NOT EXISTS activity_days (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          DATE   NOT NULL,
  minutes      INTEGER NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  last_beat_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, day)
);

-- Missões escolhidas para cada pessoa no dia. Fixa a seleção na primeira consulta:
-- missões já concluídas não somem quando acabam os alvos, e nada muda no meio do dia.
CREATE TABLE IF NOT EXISTS daily_missions (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE   NOT NULL,
  missions   TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- Sessões de login (uma por aparelho). O token de acesso dura minutos; a sessão dura
-- semanas e é renovada por um "refresh token" guardado num cookie HttpOnly.
-- Só o hash (SHA-256) do refresh token fica no banco. A cada renovação ele muda;
-- se um refresh antigo reaparecer, alguém o copiou e a sessão inteira é encerrada.
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT   NOT NULL,
  prev_hash    TEXT,               -- o refresh anterior, aceito por 30 s (abas renovando juntas)
  rotated_at   TIMESTAMPTZ,
  user_agent   TEXT   NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
