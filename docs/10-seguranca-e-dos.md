# Análise de segurança e de negação de serviço (DoS)

**Data:** 27/10/2026 · **Versão analisada:** `main` em `235c272` (com o modo "neste aparelho") · **Escopo:** backend (Express, PostgreSQL, Redis, Socket.io), frontend (React) e o código compartilhado (`shared/ranking`).

## 1. Resumo

O protótipo tem uma boa base: SQL sempre parametrizado, validação estrita com zod, contadores e saldos protegidos por transação e `CHECK`, senhas com bcrypt e nenhuma vulnerabilidade conhecida nas dependências.

O ponto mais grave era de **disponibilidade**. Uma **única conta**, com os limites de requisição ligados, conseguia deixar o servidor lento para todo mundo. Uma rota trivial passava de 2 ms para mais de 500 ms, porque o cálculo do feed "Para você" ocupava a CPU do processo e não tinha limite próprio. **Esse ponto foi corrigido nesta entrega** (§4.1): o custo de CPU caiu 12 vezes e o mesmo abuso deixou de afetar as outras pessoas.

**Atualização (28/10/2026, etapa 1):** A1, A2, A3, M7, M8 e B1 foram corrigidos, com testes (§8). Os demais itens seguem como propostas, em ordem de prioridade (§6).

**Atualização (29/10/2026, pré-produção, PR #18):** a análise por módulo em [`docs/14`](14-analise-de-brechas-por-modulo.md) avançou M4, M5 e M6 (detalhes nas seções abaixo). Desde então, o servidor também deixou de calcular o feed "Para você": o ranking roda no aparelho e `/api/feed/interesses` responde 410, o que elimina a rota de C1.

| # | Achado | Severidade | Situação |
|---|---|---|---|
| C1 | Feed "Para você": uma conta degrada o servidor inteiro (CPU no event loop, rota sem limite) | **Crítica** | **Corrigido** (e a rota não calcula mais nada: o ranking é no aparelho) |
| A1 | Segredo JWT com valor padrão conhecido | Alta | **Corrigido** (etapa 1) |
| A2 | Tokens de 7 dias sem revogação, guardados em `localStorage` | Alta | **Corrigido** (etapa 1) |
| A3 | Rotas caras ou públicas sem limite de requisições | Alta | **Corrigido** (etapa 1: limite geral) |
| M1 | Fan-out síncrono dentro da requisição de postar | Média | Proposta |
| M2 | Missões: consultas pesadas e painel coletivo recalculado a cada pedido | Média | Proposta |
| M3 | Enumeração de contas (cadastro e tempo de resposta do login) | Média | Parcial (login corrigido; cadastro pendente) |
| M4 | Limite de login só por IP, e `trust proxy` não configurado | Média | **Quase todo corrigido** (contador por conta; `TRUST_PROXY=true` recusado fora de produção). Falta separar os contadores de login e cadastro |
| M5 | WebSocket sem limites de conexões e eventos, exclusão enviada a todos | Média | **Parcial** (limites de conexões, assinaturas e tamanho). Falta enviar `post:deleted` só à audiência |
| M6 | Contas falsas podem minerar NWC pelas missões | Média | **Parcial** (sem atividade, o NWC evapora e zera em 7 dias). Verificação de conta e teto de emissão continuam propostos |
| M7 | Sem cabeçalhos de segurança (CSP, frame-ancestors, HSTS…) | Média | **Corrigido** (etapa 1) |
| M8 | Banco sem `statement_timeout` e pool pequeno amplificam lentidão | Média | **Corrigido** (etapa 1) |
| B1 | Corpo acima de 32 KB responde 500 e grava o erro completo no log | Baixa | **Corrigido** (etapa 1) |
| B2 | Busca de pessoas com `ILIKE '%…%'` (varredura completa) | Baixa | Proposta |
| B3 | Limitador em memória (quando o Redis cai) zera ao passar de 10 mil chaves | Baixa | Parcial (descarta só janelas vencidas) |
| B4 | `GET /api/missoes` grava dados (credita tokens) | Baixa | Proposta |
| I1 | Federação somente leitura e sem assinatura | Informativo | Por projeto |

## 2. Método

1. **Revisão de código** de todas as rotas, serviços, tempo real e autenticação, com referências de arquivo e linha.
2. **Medições em ambiente isolado.** Um banco separado (`social_perf`) com dados sintéticos: 5.000 contas, 50.000 posts dos últimos 7 dias, 254.310 follows, 66.664 curtidas, uma conta que segue 500 pessoas e uma "celebridade" com 4.010 seguidores. Duas instâncias do backend sobre o mesmo banco:
   - **com os limites de requisição normais**, para ver o que uma conta consegue fazer;
   - **sem limites**, para medir o custo real de cada rota, que é o que muitas contas juntas conseguiriam causar.
3. **Sinal de dano a terceiros.** Durante cada carga, uma sonda pede `/api/health` (rota trivial) a cada 50 ms. Se ela fica lenta, o problema atinge todo mundo, não só quem está abusando.
4. `npm audit` nos dois projetos.

**Fora do escopo:**
- teste de invasão em ambiente real;
- testes contra terceiros;
- DDoS volumétrico de rede (inundação de pacotes ou de conexões), que se resolve antes da aplicação (CDN, WAF, proxy reverso) e está tratado como recomendação em §5;
- escrever ferramentas de ataque. Os itens de autenticação e de WebSocket vêm da revisão de código.

## 3. O que já está bem

- **SQL parametrizado.** As únicas interpolações em SQL são nomes de tabela e coluna vindos de constantes do código (`services/interests.js:60`, `services/users.js:114`), nunca de entrada do usuário.
- **Validação estrita.** Schemas zod com `.strict()` nas preferências e na troca de modo; IDs validados por regex; limites de tamanho em textos (280 por post e 4.096 por mensagem) e no corpo JSON (32 KB).
- **Integridade financeira do token.** Saldo com `CHECK (balance >= 0)`, transferências em transação com `FOR UPDATE`, recompensas únicas por restrição do banco, e testes que conferem **saldo = soma do extrato** em todas as carteiras. Recompensar só transfere: contas em círculo não criam token.
- **Autorização.** Só o autor apaga o post; papéis de canal são conferidos no servidor; a carteira só mostra a própria.
- **Senhas e login.** bcrypt com custo 10; a mesma mensagem para "conta não existe" e "senha errada"; limite de 20 tentativas a cada 15 minutos por IP.
- **Saída segura no frontend.** O React escapa o conteúdo e não há `dangerouslySetInnerHTML`; as palavras-chave do usuário são escapadas antes de virar regex, sem risco de ReDoS.
- **Configuração.** CORS restrito a uma origem; o WebSocket exige JWT válido no handshake; `.env` fora do git.
- **Dependências.** `npm audit`: **0 vulnerabilidades** no backend e no frontend.
- **Privacidade por projeto.** O modo "neste aparelho" mantém preferências e aprendizado fora do servidor, e os candidatos não dependem das preferências.

## 4. Achados

### 4.1 C1 — Feed "Para você" derrubava o servidor para todos · Crítica · **corrigido**

**Causa.**
- O ranking roda no **event loop** do Node, a única linha de execução que atende todas as requisições.
- A etapa de diversidade (MMR) ordenava **todos** os 500 candidatos, comparando cada um com os anteriores e criando conjuntos novos a cada comparação, embora só os primeiros 40 sejam usados. Eram cerca de **194 ms de CPU por pedido**.
- A rota `GET /api/feed/interesses` **não tinha limite de requisições**.

**Medição antes da correção** (instância com limites ligados, 1 conta, 10 conexões, 8 s):

| | Antes | Depois |
|---|---|---|
| CPU do `rank()` com 500 candidatos (sessão de 40) | 193,7 ms | **15,8 ms** |
| CPU do `rank()` com 500 candidatos (sessão de 200) | 187,3 ms | **24,9 ms** |
| `/api/health` para todo mundo, durante o abuso (p50) | **544 ms** (p99 932 ms) | **5 ms** (p99 76 ms) |
| Respostas à conta abusiva | 30 × 200 (4 req/s, 1,9 s cada) | 120 × 200, depois 7.845 × 429 (baratas) |
| Sem limites (cenário de muitas contas): vazão da rota | 4 req/s | **50 req/s** |
| Sem limites: `/api/health` durante a carga (p50) | 751 ms | **46 ms** |

**Correção aplicada:**

1. `shared/ranking/ranking.js`: o MMR **para no limite da sessão** e prepara tópicos, autores e IDs uma vez só. O custo cai de O(n² · janela) para O(n · limite · janela). Como o código é compartilhado, o navegador (modo "neste aparelho") também ficou mais rápido.
2. **Resultado idêntico.** Um teste compara a nova versão com a original em **300 casos aleatórios com empates de nota** e exige a mesma ordem. Outro garante que 500 candidatos ficam abaixo de 50 ms.
3. `routes/feed.js`: limite de **120 pedidos a cada 15 minutos por conta** em `/api/feed/interesses`. Uma sessão normal usa 2 ou 3.

**O que ainda falta:** com milhares de contas ao mesmo tempo, o ranking volta a disputar CPU (46 ms de p50 na sonda sem limites). Os próximos passos são:
- guardar o ranking da sessão por alguns minutos (Redis), em vez de recalcular a cada página;
- rodar o ranking em `worker_threads`;
- usar o modo "neste aparelho" como padrão, o que tira esse custo do servidor.

### 4.2 A1 — Segredo JWT com valor padrão · Alta · **corrigido**

**Evidência:**
- `backend/src/config.js:11` usa `'dev-only-secret'` quando `JWT_SECRET` não existe.
- `backend/.env.example:6` traz um valor de exemplo que o README manda copiar para `.env`.

**Impacto:** quem conhece o segredo consegue emitir tokens válidos **para qualquer conta**, sem senha. Isso vale para HTTP e para o WebSocket. Como os dois valores estão publicados no repositório, qualquer instalação que use os padrões fica exposta.

**Correção proposta:**
- recusar a inicialização, fora de `NODE_ENV=test`, se `JWT_SECRET` faltar, tiver menos de 32 bytes ou for igual a um valor conhecido;
- gerar o segredo no setup (`openssl rand -base64 48`);
- trocar o valor do `.env.example` por um marcador vazio.

**Correção aplicada:** `resolveJwtSecret()` em `config.js`. Segredo conhecido ou com menos de 32 caracteres impede o servidor de iniciar, em qualquer ambiente. Sem segredo, produção não inicia; em desenvolvimento um segredo aleatório é gerado a cada início (as sessões sobrevivem, porque a renovação não depende dele). O `.env.example` agora vem vazio. Os tokens também passaram a exigir `HS256` e o campo `sid`.

### 4.3 A2 — Tokens sem revogação e em `localStorage` · Alta · **corrigido**

**Evidência:**
- o token dura 7 dias (`config.js:12`);
- o logout só apaga o token no cliente;
- o token fica em `localStorage` (`frontend/src/lib/api.js:1`), junto com as preferências do modo aparelho.

**Impacto:** um token vazado, por XSS, extensão maliciosa ou aparelho compartilhado, continua valendo por até 7 dias, e não há como encerrar sessões. Combinado com M7 (sem CSP), qualquer XSS vira tomada de conta.

**Correção proposta:**
- token de acesso curto (15 minutos) com um token de renovação rotativo em cookie `HttpOnly; Secure; SameSite=Strict`;
- uma coluna `users.token_version`, incluída no JWT e conferida a cada requisição, que permite "sair de todos os aparelhos" e invalidar tokens ao trocar a senha.

**Correção aplicada** (com uma tabela de sessões no lugar de `token_version`, para poder encerrar um aparelho só):
- token de acesso de **15 minutos**, que carrega o id da sessão (`sid`);
- tabela `sessions` e refresh token `<sid>.<segredo>` em cookie `HttpOnly; SameSite=Strict; Path=/api/auth` (`Secure` com `COOKIE_SECURE=true`). O banco guarda só o SHA-256;
- **rotação** a cada renovação, atômica. Se um refresh antigo reaparece, alguém o copiou: a sessão inteira é encerrada. A exceção é o refresh recém-trocado nos últimos 30 s (duas abas renovando juntas): ele recebe só um token de acesso, sem cookie novo;
- `POST /api/auth/logout` encerra a sessão na hora: o `sid` entra numa lista de revogados (Redis + memória, por 15 min) conferida em cada pedido e no WebSocket, e a conexão em tempo real daquele aparelho cai;
- `POST /api/auth/logout-all` ("Sair de todos os aparelhos", na tela de perfil);
- no navegador, o token de acesso fica só na memória da aba. O token antigo do `localStorage` é apagado ao abrir o app.

### 4.4 A3 — Rotas caras ou públicas sem limite · Alta · **corrigido (limite geral)**

**Evidência** (só 7 limitadores em todo o backend: auth, timeline, posts, mensagens, convites, candidatos e, agora, interesses). Medições sem limites:

| Rota | Login | Custo medido | Observação |
|---|---|---|---|
| `GET /api/missoes` | sim | 151 ms por pedido; a 1ª do dia leva 570 ms (2,9 s com o banco frio) | 48 req/s de uma conta; a sonda segue em 4 ms, o gargalo é o banco |
| `GET /api/posts?max_results=100` | **não** | 8 ms, 51 KB | 256 req/s e **13 MB/s** de um único cliente: raspagem e banda |
| `GET /api/feed/candidatos` | sim | 29 ms, **248 KB** | já limitado (60 a cada 15 min), e funcionou: 10.324 × 429 |
| `POST /api/atividade` | sim | 5 ms, **grava no banco** | o servidor ignora sinais a menos de 55 s, mas cada pedido ainda lê e escreve |
| Curtir, repostar, seguir, reagir | sim | gravações; repostar dispara fan-out | sem limite por conta |
| Perfis, seguidores, threads (até 500 posts), busca, outbox | **não** | baratos | permitem raspagem em massa |

**Correção proposta:**
- um **limite padrão para toda a API** (por exemplo, 300 pedidos a cada 15 minutos por conta e 600 por IP para quem não está logado), com limites mais estritos nas rotas que gravam (curtidas, follows e reações: 60 por minuto) e em `/api/atividade` (2 por minuto);
- aplicar o mesmo limite também na borda (§5).

### 4.5 M1 — Fan-out síncrono · Média

**Evidência:** `services/timeline.js:64`. O post de uma conta com 4.010 seguidores levou **228 a 337 ms** dentro da própria requisição, montando um pipeline Redis com 8.020 comandos no event loop. O custo cresce de forma linear: uma conta com 100 mil seguidores levaria segundos e travaria o processo durante esse tempo.

**Correção proposta:**
- mover o fan-out para uma **fila** (BullMQ ou similar), executada por workers;
- adotar o **modelo híbrido**: acima de N seguidores, misturar os posts na leitura, como já descreve `docs/03-arquitetura.md` §6.

### 4.6 M2 — Missões pesadas · Média

**Evidência:** consultas medidas na 1ª chamada do dia (`services/missions.js:235`):
- a sugestão de "Amplifique uma voz pequena" levou **398 ms**, porque conta os seguidores do autor **para cada post** dos últimos 3 dias (`missions.js:160`);
- o painel coletivo levou **58 a 63 ms** e é recalculado **a cada** `GET /api/missoes` (`missions.js:216`).

**Correção proposta:**
- reescrever a sugestão para agregar os seguidores **por autor** uma única vez (CTE com `GROUP BY`) e limitar antes aos posts mais recentes;
- guardar o painel coletivo em cache por 60 segundos (Redis), já que ele é igual para todo mundo.

### 4.7 M3 — Enumeração de contas · Média

**Evidência:**
- o cadastro responde `409 "Usuário ou e-mail já cadastrado"` (`services/users.js:33`), o que revela se um **e-mail** existe na instância;
- no login, a verificação bcrypt só roda quando a conta existe (`routes/auth.js:37`). A resposta para conta inexistente sai em poucos milissegundos, contra dezenas para uma senha errada, e essa diferença de tempo também revela quem tem conta.

**Correção proposta:**
- no login, comparar sempre com um hash fictício quando a conta não existir;
- no cadastro, diferenciar só o username (que é público por projeto) e tratar o e-mail sem confirmar existência, com verificação por e-mail;
- manter o limite por IP.

**Correção aplicada no login (28/10/2026):** o bcrypt roda sempre, contra um hash falso de mesmo custo quando a conta não existe, e a mensagem é única ("E-mail ou senha incorretos"). O login agora é por e-mail e senha. O cadastro ainda responde 409 para e-mail repetido; resolver isso exige confirmação por e-mail.

**Recuperar senha (30/10/2026):** `POST /api/auth/senha/esqueci` dá a mesma resposta exista ou não a conta, então não abre um novo jeito de descobrir quem tem conta. O link é um token aleatório de 32 bytes: o banco guarda só o hash SHA-256, ele vale 30 minutos e uma vez só. Há no máximo 3 por hora por conta e limite por IP. Trocar a senha invalida os outros links e encerra todas as sessões. A tela tira o token da barra de endereço assim que o lê. O e-mail ainda não sai de verdade (vai para o log do servidor); um serviço de e-mail real fica para a produção.

### 4.8 M4 — Limite de login só por IP · Média

**Evidência:** `routes/auth.js:25` usa a chave `req.ip`, e login e cadastro dividem o mesmo contador. Não há `app.set('trust proxy', …)`.

**Impacto:**
- atrás de um proxy reverso, todos os usuários aparecem com o IP do proxy e **um único abusador bloqueia o login de todos**;
- se o `trust proxy` for configurado sem cuidado, o cabeçalho `X-Forwarded-For` pode ser falsificado para driblar o limite;
- tentativas distribuídas por muitos IPs contra **uma** conta não são contidas.

**Correção proposta:**
- configurar `trust proxy` com o número exato de saltos do proxy;
- separar os contadores de login e de cadastro;
- adicionar um contador **por conta**, com espera crescente após falhas, sem bloquear a conta de forma permanente.

**Correção aplicada (PR #18):**
- contador **por conta**: 10 senhas erradas em 15 minutos bloqueiam novas tentativas naquela conta até a janela passar, sem bloqueio permanente (`failureCounter` em `lib/rateLimit.js`);
- `TRUST_PROXY=true` (confiar em qualquer proxy) é recusado fora de produção e só gera aviso em produção; use o número de saltos;
- o recurso de suspensão divide o limite `auth`.

Login e cadastro ainda dividem o mesmo contador por IP.

### 4.9 M5 — WebSocket sem limites · Média

**Evidência** (`backend/src/realtime/socket.js`):
- nenhuma restrição ao número de conexões por conta;
- `channel:subscribe` (linha 26) faz uma consulta ao banco **a cada evento**, sem limite de frequência;
- o tamanho máximo de mensagem é o padrão do Socket.io (1 MB);
- `post:deleted` é enviado com `io.emit` a **todas** as conexões (linha 50).

**Impacto:** uma conta pode abrir muitas conexões e emitir eventos que consultam o banco sem parar, e cada exclusão vira uma mensagem para cada pessoa conectada (amplificação proporcional ao número de pessoas online).

**Correção proposta:**
- limitar a 5 conexões por conta;
- aplicar um balde de tokens por conexão (por exemplo, 10 eventos por segundo);
- `maxHttpBufferSize` de 16 KB;
- guardar em memória os canais já assinados;
- enviar `post:deleted` só para as salas da audiência do post.

**Correção aplicada (PR #18)** (`WS_LIMITS` em `realtime/socket.js`):
- 10 conexões por conta;
- 50 canais por conexão, guardados em memória;
- 30 assinaturas por minuto;
- `maxHttpBufferSize` de 16 KB.

O `post:deleted` continua indo para todas as conexões. Ele só leva o id do post.

### 4.10 M6 — Contas falsas e o token NWC · Média

**Evidência:** o cadastro é aberto e não há verificação de e-mail. As regras das missões (curtidas de 3 pessoas diferentes, comentários com 15 caracteres) podem ser cumpridas por um grupo de contas falsas, e cada conta emite até 13 NWC por dia (`docs/09-token-interno.md`).

**Impacto hoje:** baixo, porque o token não tem utilidade além de recompensar. **Passa a ser alto no momento em que o token ganhar qualquer utilidade.**

**Correção proposta, antes de dar utilidade ao token:**
- verificação de conta (e-mail; opcionalmente, convite obrigatório);
- teto de emissão por instância e por dia;
- ignorar interações entre contas novas ou de baixa confiança para fins de missão;
- painel de anomalias (grupos que só interagem entre si).

**Correção aplicada (PR #18):** **evaporação**. Sem atividade, o saldo de NWC evapora aos poucos (cada dia inteiro parado leva uma parte) e zera em 7 dias; quem volta ao app para de perder (`services/evaporation.js`, [`docs/09`](09-token-interno.md)). Isso desestimula juntar NWC em contas falsas paradas. Verificação de conta e teto de emissão continuam propostos.

### 4.11 M7 — Sem cabeçalhos de segurança · Média · **corrigido**

**Evidência:** não há `helmet` nem cabeçalhos definidos no backend, e o frontend em produção também não tem política definida.

**Impacto:**
- sem CSP, um XSS consegue ler o token e as preferências do `localStorage` (A2);
- sem `frame-ancestors`, a página pode ser embutida em outros sites (clickjacking);
- sem HSTS, o primeiro acesso pode acontecer em HTTP.

**Correção proposta:**
- `helmet` no backend;
- no servidor que entrega o frontend: CSP restrita (`default-src 'self'`; fontes do Google Fonts liberadas), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` e HSTS.

**Correção aplicada**, sem dependência nova (`lib/securityHeaders.js`):
- API: CSP `default-src 'none'; frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP, `Permissions-Policy` e HSTS quando a conexão é HTTPS; `Cache-Control: no-store` nas rotas de login;
- frontend: CSP na versão final (`vite build`), com scripts só do próprio site. No modo dev ela fica desligada, porque o Vite injeta scripts inline. `frame-ancestors` e HSTS da página dependem do servidor que a entregar (§5).

### 4.12 M8 — Banco sem tempo limite · Média · **corrigido**

**Evidência:** `db.js:6` cria um pool de 10 conexões sem `statement_timeout`.

**Impacto:** consultas lentas (como as de M2 com o banco frio) seguram conexões, e com o pool cheio as demais requisições entram em fila. Uma consulta pesada repetida esgota o pool.

**Correção proposta:**
- `statement_timeout` de 2 s por conexão (exceto no seed e na migração);
- `connectionTimeoutMillis` no pool;
- dimensionar o pool junto com o `max_connections` do Postgres.

**Correção aplicada:** `statement_timeout` de 5 s (`DB_STATEMENT_TIMEOUT_MS`), `idle_in_transaction_session_timeout` de 10 s e espera máxima de 5 s por conexão livre. O pool é configurável (`DB_POOL_MAX`). Consulta cancelada ou pool esgotado viram **503** com `Retry-After`, em vez de pedidos presos.

### 4.13 Achados baixos

- **B1 — Corpo grande demais vira erro 500.** O limite de 32 KB funciona (`app.js:19`), mas o tratamento de erros não reconhece `entity.too.large`. A resposta é **500 "Erro interno"** e o erro completo vai para o log a cada pedido, o que permite encher o log com pouco esforço (confirmado com uma requisição de 40 KB). Correção: responder **413** sem registrar o erro completo. **Corrigido:** 413 com mensagem curta; erros 4xx do Express não vão mais para o log.
- **B2 — Busca com `ILIKE '%…%'`** (`services/users.js:124`). Ela varre a tabela inteira: 9 a 13 ms com 5 mil contas, crescendo de forma linear. Correção: índice `pg_trgm` em `username` e `display_name`, com um limite de requisições na rota.
- **B3 — Limitador em memória.** Quando o Redis cai, o contador em memória é apagado inteiro ao passar de 10 mil chaves (`lib/rateLimit.js:24`), zerando todos os limites, e cada processo conta separadamente. Correção: descartar só as entradas mais antigas, e falhar fechado (recusar) nas rotas de login quando o Redis estiver fora. **Parcial:** agora só as janelas vencidas são descartadas; falhar fechado continua proposto.
- **B4 — `GET /api/missoes` grava dados.** A rota credita tokens. É idempotente e exige token no cabeçalho (sem risco de CSRF), mas um `GET` com efeito colateral pode ser disparado por pré-carregamentos e caches. Correção: creditar só em `POST /api/missoes/verificar`, ou documentar o comportamento.
- **I1 — Federação.** A federação é somente leitura e sem assinatura, por projeto (`docs/03` §5). Ao implementar o `inbox`, será preciso:
  - exigir HTTP Signatures;
  - proteger contra SSRF ao buscar atores remotos (bloquear IPs internos e limitar tempo e tamanho das respostas);
  - limitar a entrega por domínio.

## 5. DDoS volumétrico (camada de rede)

Inundação de conexões, de pacotes ou de requisições vindas de muitas origens não se resolve só na aplicação. Para qualquer exposição fora da rede local:

- **Proxy reverso** (nginx, Caddy ou Traefik) na frente do Node, com:
  - limite de requisições por IP (`limit_req`) e de conexões simultâneas;
  - corpo máximo de 32 KB;
  - tempos limite curtos de cabeçalho e de corpo, contra clientes lentos que seguram conexões;
  - limite de upgrades para WebSocket.
- **CDN ou WAF** com mitigação de DDoS para as rotas públicas (`/api/posts`, perfis, outbox), mais cache curto das respostas públicas.
- **No Node:** `server.headersTimeout`, `server.requestTimeout` e `keepAliveTimeout` com valores baixos, e um limite de conexões (`server.maxConnections`).
- **Escala horizontal:** vários processos ou contêineres atrás do proxy, com o adapter Redis do Socket.io e o limitador sempre no Redis (B3).
- **Observabilidade:** métricas de atraso do event loop, de uso do pool do banco e de respostas 429, com alertas. O atraso do event loop é exatamente o sinal que revelou o C1.

## 6. Plano de correção

| Ordem | Itens | Esforço | Por quê |
|---|---|---|---|
| **Feito** | C1 (MMR otimizado + limite em `/api/feed/interesses`) | — | Uma conta derrubava o serviço |
| **Feito (etapa 1)** | A1, A2, A3 (limite geral), M7, M8, B1; `trust proxy` configurável; B3 parcial | — | Autenticação e base pronta para rede aberta (§8) |
| **Feito (PR #18)** | M4 (limite por conta, `trust proxy` seguro), M5 (limites do WebSocket), M6 parcial (evaporação); demais achados de [`docs/14`](14-analise-de-brechas-por-modulo.md) | — | Pré-produção |
| 2 | M3 (cadastro), resto de M4 (separar contadores de login e cadastro) e de M5 (`post:deleted` só para a audiência) | Médio | Fecha o que resta da autenticação e do tempo real |
| 3 | M2 (consultas e cache das missões), B2, B3 (falhar fechado), B4 | Médio | Robustez sob carga |
| 4 | M1 (fan-out em fila e híbrido), proxy reverso e observabilidade (§5) | Maior | Escala |
| Antes de dar utilidade ao NWC | Resto de M6 (verificação de conta e teto de emissão) | Médio | O incentivo econômico muda o modelo de ameaça |

## 7. Como reproduzir as medições

1. Crie o banco `social_perf`, aplique o schema e carregue os dados sintéticos descritos em §2. A carga usa `generate_series`, roda em cerca de 10 s e não toca no banco de desenvolvimento.
2. Suba duas instâncias do backend apontando para ele: uma normal e outra com `DISABLE_RATE_LIMIT=1`, em portas diferentes.
3. Rode a carga de 10 conexões por 8 s (autocannon) em uma rota enquanto uma sonda mede `/api/health` a cada 50 ms, e compare com a sonda em repouso.

As medições foram feitas só contra instâncias locais deste projeto.

## 8. Etapa 1, em linguagem simples

O que mudou, para quem não é da área. A analogia é um prédio com portaria.

| Correção | Antes | Agora | Por que importa |
|---|---|---|---|
| **Segredo forte (A1)** | O "carimbo" que a portaria usa para validar crachás tinha um modelo público, escrito no próprio repositório. | O servidor não liga com carimbo conhecido ou fraco. Cada instalação tem o seu. | Com o carimbo público, qualquer pessoa fabricava um crachá de qualquer morador, sem senha. |
| **Sessões que podem ser encerradas (A2)** | O crachá valia 7 dias e "Sair" só jogava fora a cópia do seu celular. Uma cópia roubada continuava abrindo a porta. | O crachá vale 15 minutos e é trocado sozinho, sem pedir senha. "Sair" cancela na hora. "Sair de todos os aparelhos" cancela todos. Uma cópia roubada e reusada denuncia o roubo e encerra a sessão. | Celular perdido, computador emprestado ou link malicioso deixam de virar acesso por dias. |
| **Crachá fora do alcance de scripts (A2)** | O crachá ficava numa gaveta que qualquer script da página podia abrir (`localStorage`). | A parte que dura semanas fica num cofre que só o navegador abre (cookie HttpOnly). O crachá curto fica só na memória da aba. | Um texto malicioso que conseguisse rodar na página não leva mais a sua conta junto. |
| **Limite geral de pedidos (A3)** | Só algumas portas tinham catraca. Nas outras, uma pessoa podia entrar e sair milhares de vezes por minuto. | Toda a API tem catraca: 600 pedidos a cada 5 minutos por pessoa (ou por IP sem login), além dos limites mais rígidos que já existiam. | Uma conta (ou um robô) não consegue mais deixar o app lento para todo mundo, nem copiar a rede inteira de uma vez. |
| **Cabeçalhos de proteção (M7)** | O navegador não recebia regras do que a página podia carregar ou executar. | O app diz ao navegador: "só rode código do próprio Ágora" e "não deixe outro site me exibir escondido". | Impede golpes como esconder o Ágora dentro de outro site para enganar cliques, e reduz o estrago se algum texto malicioso escapar. |
| **Tempo-limite no banco (M8)** | Uma consulta travada segurava uma das 10 "linhas de atendimento" do banco sem prazo. | Nenhuma consulta passa de 5 segundos. Se o banco estiver cheio, a pessoa recebe "tente de novo em instantes" em vez de esperar sem fim. | Um pedido pesado não congela o atendimento de todos. |
| **Erro sem detalhes internos (B1)** | Um envio grande demais virava "erro interno" e escrevia o erro completo no registro do servidor. | Resposta clara ("grande demais, máximo de 32 KB") e nada no registro. | Evita encher o registro de lixo de propósito e não expõe detalhes do servidor. |

**Como foi verificado:**
- 20 testes novos no backend (`test/security.test.js`, incluindo duas abas renovando ao mesmo tempo) e 5 no frontend (`src/lib/api.test.js`), além dos que já existiam;
- teste no navegador com a versão final do app e tokens de 5 s: login, recarregar a página continua logado, renovação automática sem pedir senha, mensagem em tempo real depois da renovação, "Sair" invalida o token copiado, "Sair de todos" desconecta o outro aparelho e nenhum bloqueio indevido da política de conteúdo.

**Para quem instala:** deixe `JWT_SECRET` vazio em desenvolvimento ou gere um com `openssl rand -hex 32`. Um `.env` antigo com o valor de exemplo faz o servidor recusar iniciar, com a instrução na mensagem. Em HTTPS, ligue `COOKIE_SECURE=true`. Atrás de proxy reverso, ajuste `TRUST_PROXY`.
