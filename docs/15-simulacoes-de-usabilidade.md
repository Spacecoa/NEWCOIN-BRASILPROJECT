# Simulações de uso: 100 cenários independentes

**Data:** 29/10/2026 · **Versão:** branch `claude/decentralized-social-network-wolm3h` (após o PR #17, com as correções e decisões do PR #18)

## 1. Resultado

**98 das 100 simulações passaram. 2 encontraram falhas** e 5 passaram com uma observação (ℹ️). Além disso, a conferência dos documentos achou 5 trechos que não batem mais com o app.

| | |
|---|---|
| Simulações na API (HTTP, WebSocket e o cálculo do algoritmo) | 76: todas passaram |
| Simulações na tela (navegador de verdade, celular 390 × 844) | 24: 22 passaram, 2 falharam |
| Falhas reais do app | 2 (convite só pela missão; falta a região `<main>` em 3 telas) |
| Observações de usabilidade | 3 |
| Documentos desatualizados | 5 |

Nenhuma simulação encontrou erro interno (HTTP 5xx), vazamento de dados, interação de visitante que funcionasse, nem divergência entre os números dos documentos e os do app.

Na primeira rodada, 14 simulações falharam. **12 eram erros das próprias simulações** (conta de saldo errada, esperar a lista carregar, texto em maiúsculas pelo CSS, expectativa de redirecionar para o login depois de sair, entre outros). Em cada uma conferi no código e na tela que o app estava certo e corrigi a simulação. Só as 2 falhas restantes são do app.

### Correções feitas depois das simulações

| # | O que mudou | Conferido por |
|---|---|---|
| S095 | "Gerar convite" fica sempre em **"Seus convites"** (Missões), inclusive nos dias sem a missão de convite e com as missões escondidas. No dia da missão, o botão fica só no cartão dela, para não aparecer duas vezes | S095 reescrita (exatamente 1 botão, em qualquer dia) e 2 testes em `Missions.test.jsx` |
| S099 | `/login`, `/cadastro` e a tela de conta suspensa usam `<main>`. `/regras` usa `<main>` para visitantes; logada, ela já fica dentro do `<main>` do layout, sem um segundo | S099 e testes em `Login.test.jsx`, `Register.test.jsx` e `Rules.test.jsx` (novo) |
| D1 | README com 213 testes no backend e 68 no frontend | — |
| D2 | `docs/03` §4: rotas do algoritmo no aparelho, `/api/dados`, `/api/conta/*`, moderação de regras, recursos e reativação, remover e banir em grupos, motivos de denúncia, nodeinfo e leitura aberta a visitantes | conferido contra `backend/src/routes` |
| D3 | `docs/08`: 4 missões por dia (2 + 2), convite sempre disponível e os 4 NWC da missão "Traga alguém de confiança" | — |
| D4 | `docs/10`: M4 quase todo corrigido, M5 e M6 parciais, com o que ainda falta | — |
| D5 | O seed também apaga as regras da instância e `moderator_names_missing`, e recria as 7 regras padrão. Uma regra feita à mão some depois do seed (8 → 7) | conferido no banco de desenvolvimento |

**Nova rodada depois das correções: 100 de 100 passaram** (76 de API e 24 na tela).

**Segunda rodada de correções (30/10/2026):** as 3 observações de usabilidade (§4.2) também foram resolvidas, e as simulações S078, S096 e S100 passaram a **reprovar** se elas voltarem (antes só anotavam):

| # | O que mudou |
|---|---|
| S100 | Sem rede, o app diz "Sem conexão com o servidor. Confira sua internet e tente de novo." em vez de "Failed to fetch". Toda tela que carrega dados (Canais, Brasil, perfil, thread, Meu algoritmo, canal, regras, carteira, missões e a fila da moderação) mostra "Tentar de novo", que carrega sem recarregar a página |
| S078 | Ao sair, a faixa de visitante mostra "Você saiu da sua conta.", com um botão para fechar o aviso |
| S096 | A Selic aparece como "13,75% ao ano", sem espaço antes do `%`, no app e na demo |

Rodada final: 100 de 100, sem observações.

**Depois das notificações e da recuperação de senha (30/10/2026):** a S100 passou a percorrer a aba **Notificações** (que substituiu Menções na navegação). A S083 falhou uma vez numa rodada completa. A causa: recompensar um post também cumpre a missão "Recompense alguém" (+1 NWC, `docs/08`), que só é sorteada em parte dos dias para cada conta. Quando ela sai, o saldo certo é 3, não 2. O app estava certo; a simulação agora calcula o saldo esperado pelo extrato. Nova rodada: 100 de 100.

**Privacidade do piloto (31/10/2026):** cinco simulações novas, numeradas de **S101 a S105** para não mudar a numeração das 100 primeiras (tabela no fim). Elas cobrem baixar os dados, excluir a conta e o termo de consentimento ([`docs/16`](16-privacidade-e-dados.md)). A S077 (cadastro pela tela) passou a exigir os dois aceites e a mostrar o termo, e a S099 (acessibilidade) passou a auditar a página `/termo`. Na primeira rodada, a S104 falhou: depois de excluir a conta, o app ia para a leitura de visitante, e não para a tela de entrar que a simulação esperava. O comportamento foi mantido, porque é o mesmo de "Sair" (aviso no topo da leitura de visitante), e a simulação foi ajustada. Nova rodada: **105 de 105** (79 de API e 26 na tela).

## 2. Como foi feito

- **Ambiente:** o app rodando localmente, com os dados do seed. Duas instâncias com o mesmo banco: uma **sem limite de pedidos** para as simulações comuns e outra **com os limites normais** para as que testam os limites (denúncias por dia, pedidos por pessoa, senhas erradas por conta, tentativas de entrada por IP, evaporação ao voltar).
- **Independência:** cada simulação cria as próprias contas (o nome leva o número da simulação), não lê nada de outra e começa com os contadores de limite zerados. A ordem não importa. A única que roda por último é a do limite de entrada por IP, só porque ela gasta o limite do IP.
- **Fonte das regras:** os documentos do projeto (README e `docs/01` a `docs/14`). Cada simulação cita o documento de onde vem a regra que confere.
- **Tempo:** duas simulações "viajam no tempo" por SQL (evaporação em 3 e 7 dias, e o saldo de 50 NWC para chegar ao limite de 20 recompensas). O restante usa o relógio real.
- **Limites do método:** são **simulações automatizadas de uso**, não pessoas testando. Elas conferem o que o app faz e o que ele escreve na tela. Não medem se uma tela é agradável ou clara para alguém que nunca a viu. O ambiente não alcança IBGE, Banco Central nem DIEESE, então a aba Brasil foi conferida com o registro conferido à mão, que é como ela foi desenhada.

## 3. Resultado por área

| Área | Simulações | Passaram |
|---|---|---|
| Contas e sessão | 7 | 7 |
| Convites | 2 | 2 |
| Posts | 9 | 9 |
| Visitantes | 2 | 2 |
| Perfis | 1 | 1 |
| Moderação | 12 | 12 |
| Regras da instância | 2 | 2 |
| Missões e token | 10 | 10 |
| Brasil em dados | 3 | 3 |
| Federação | 2 | 2 |
| Segurança e limites | 5 | 5 |
| Algoritmo "Para você" | 8 | 8 |
| Canais e grupos | 10 | 10 |
| Tempo real | 3 | 3 |
| Cadastro e entrada | 2 | 2 |
| Visitante | 1 | 1 |
| Posts na tela | 3 | 3 |
| Token na tela | 1 | 1 |
| Algoritmo na tela | 2 | 2 |
| Perfis na tela | 2 | 2 |
| Moderação na tela | 5 | 5 |
| Tempo real na tela | 2 | 2 |
| Missões na tela | 1 | 0 |
| Brasil na tela | 1 | 1 |
| Regras na tela | 1 | 1 |
| Layout | 1 | 1 |
| Acessibilidade | 1 | 0 |
| Navegação e erros | 1 | 1 |

## 4. Achados

### 4.1 Falhas do app

| # | Gravidade | O que acontece | O que o documento diz | Sugestão |
|---|---|---|---|---|
| **S095** | Média | O botão **"Gerar convite"** só existe no cartão da missão "Traga alguém de confiança". Essa missão só é sorteada em parte dos dias (2 de cerca de 7 possíveis). No resto, a tela não oferece jeito nenhum de convidar, embora a API ofereça (`POST /api/convites`). | `docs/08` §5: "Cada pessoa gera convites de uso único". O crescimento por convite é um dos pilares do projeto. | Mostrar "Gerar convite" sempre, na seção "Seus convites" da página de Missões, ou no perfil. |
| **S099** | Baixa | `/login`, `/cadastro` e `/regras` não têm a região `<main>`. Quem usa leitor de tela não consegue pular direto para o conteúdo. As demais telas têm. | Não está nos documentos. É uma boa prática de acessibilidade (WCAG 1.3.1 e 2.4.1). | Envolver o conteúdo dessas três telas em `<main>`. |

O resto da acessibilidade passou: todos os botões, links e campos têm nome, não há imagem sem `alt`, o idioma é `pt-BR`, toda tela tem título e a ordem do Tab no login é e-mail, senha, mostrar senha, entrar.

### 4.2 Observações de usabilidade (as simulações passam, mas vale melhorar) · **resolvidas em 30/10/2026, ver §1**

1. **Sem rede (S100):** as telas mostram a mensagem técnica do navegador em inglês, "Failed to fetch". Início e Explorar oferecem "Tentar de novo". **Canais não oferece, e mostra "Carregando…" junto do erro.** Sugestão: uma mensagem em português ("Sem conexão. Tente de novo.") e o botão em todas as telas.
2. **Ao sair (S078):** nada confirma que a sessão terminou. O aviso "Você saiu da sua conta." só existe na tela de entrar, mas hoje quem sai cai na versão de visitante da mesma página. A faixa "Você está só lendo" é a única pista. Sugestão: mostrar o aviso na faixa.
3. **Selic (S096):** aparece como "13,75 % ao ano", com espaço antes do `%`, enquanto os outros indicadores aparecem como "4,58%".

### 4.3 Documentos que não batem mais com o app

O app funciona como o conjunto dos documentos mais recentes descreve. Estes trechos são de versões anteriores:

| # | Onde | O que está escrito | Como é hoje |
|---|---|---|---|
| D1 | `README.md`, "Testes" | 183 testes no backend e 53 no frontend | 213 no backend e 64 no frontend |
| D2 | `docs/03` §4, tabela da API | `GET /api/feed/interesses` como feed do servidor; `PUT /api/feed/modo` com `server` ou `device`; preferências do algoritmo no servidor. Faltam as rotas de dados (`/api/dados`), remover e banir pessoas de grupos, motivos de denúncia, `/api/conta/*` e as rotas de moderação de regras, recursos e reativação | `/api/feed/interesses` responde 410; `/feed/modo` só aceita `device`; o servidor só guarda missões e contagem de tempo (`docs/07` §2.10) |
| D3 | `docs/08` | §5: "Não há recompensa por convite". §3, diagrama e testes: "pega as 3 primeiras" e "no máximo 3" missões | A missão "Traga alguém de confiança" paga 4 NWC (`docs/09`), e o app entrega 4 missões por dia (2 de rede e 2 de engajamento), como o resto do próprio `docs/08` |
| D4 | `docs/10`, tabela de status | M3, M4, M5 e outros itens como "Proposta" ou "Parcial" | Boa parte foi corrigida no PR #18 (ver `docs/14`): limite de senhas por conta, limites no WebSocket, etc. |
| D5 | `backend/src/seed.js` | "apaga tudo e recria" | As regras da instância e as marcações de moderação não são apagadas. Depois de rodar o seed, uma regra criada à mão continuava lá, e a tela de cadastro mostrou 8 regras em vez das 7 documentadas |

## 5. O que as simulações confirmaram

- **Contas e sessão:** cadastro com aceite obrigatório das regras; token de 15 min e cookie `HttpOnly` + `SameSite=Strict`; mesma resposta para senha errada e conta inexistente; renovação com rotação e tolerância de 30 s; sair vale na hora, inclusive "sair de todos os aparelhos"; convite de uso único; 10 convites abertos no máximo.
- **Posts:** 280 caracteres; threads; menções (até 10); curtir e repostar idempotentes; só o autor apaga; timeline Seguindo com cursor sem repetição; visitante lê tudo e não interage com nada.
- **Algoritmo no aparelho:** o servidor não calcula nem guarda nada do algoritmo; os candidatos são iguais para todo mundo; o aprendizado, o "menos disto" e as preferências ficam só no `localStorage`, sobrevivem a recarregar e a sair e entrar, e a outra conta no mesmo navegador não herda; contas antigas são importadas uma vez.
- **Canais:** `pts` sem buracos com 10 mensagens ao mesmo tempo; `/difference` e `too_long`; reações com 8 emojis e até 3 por pessoa; papéis; remover e banir; grupo só de quem entrou; mensagem chega ao vivo em milissegundos; no máximo 10 conexões por conta.
- **Moderação, regras e recursos:** silenciar, bloquear nos dois sentidos, denunciar; a fila só para a moderação; remover e suspender exigem a regra; recurso único; aceitar devolve o post com as curtidas; suspensa vê o motivo e recorre por e-mail e senha; regras editáveis com arquivamento.
- **Missões e token:** 4 missões por dia e estáveis; "Apresente-se" primeiro para conta nova; regras de qualidade de "Curta 5 posts" e "Comente 3 posts"; recompensa só transfere; limite de 20 por dia; **evaporação**: 14 → 8 NWC em 3 dias e 0 em 7; nada é descontado duas vezes.
- **Brasil em dados:** 5 indicadores, 5 anos de histórico, selos, links e "ainda não conferida" onde falta; atualizar à força só para a moderação e sem apagar o último dado bom.
- **Federação:** WebFinger, NodeInfo, ator e outbox com o texto escapado.
- **Segurança e limites:** cabeçalhos de proteção, CORS só para o app, parâmetros estranhos sem erro interno e sem mexer no banco, limites de pedidos, de senhas por conta e de tentativas por IP.
- **Tela:** sem rolagem horizontal em 320, 390, 768 e 1280 px; menu inferior no celular e coluna lateral no desktop; todas as abas levam à tela certa.

## 6. O que as simulações não cobrem

Para não dar a impressão de que "100 simulações" é tudo:

- **Missões individuais** que dependem de situações montadas (receber quem chegou, ponte, voz pequena, conversa coletiva, republicar, recompensar e responder a primeira pergunta). A regra geral, a estabilidade e as missões "Apresente-se", "Curta 5", "Comente 3", "Abra um espaço" e "Traga alguém de confiança" foram simuladas.
- **Fim de sessão do "Para você"** ("Você está em dia") e os controles de "Meu algoritmo" além de palavra-chave (pesos, tópicos, limite de sessão, esconder contadores).
- **Minutos ativos na tela** (o sinal a cada minuto com a aba visível). A regra do servidor foi simulada, mas não o temporizador do navegador.
- **Cadastro por link de convite na tela** (`/cadastro?convite=`), tema escuro e a demo interativa (`demo/index.html`).
- **Pessoas de verdade:** clareza dos textos, ordem em que alguém procura as coisas, e se o app é agradável.

## 7. Como repetir

Precisa de Postgres e Redis, do banco com o seed e de Playwright. O app precisa estar rodando em duas instâncias:

```bash
cd backend && npm run seed
# instância com os limites normais (porta 4000) e outra sem limite de pedidos (porta 4020)
npm run dev
PORT=4020 WORKER_ID=2 DISABLE_RATE_LIMIT=1 INSTANCE_DOMAIN=localhost:4020 node src/server.js
# frontend apontando para a instância sem limite, na porta 4174
cd ../frontend && npm run build && BACKEND_URL=http://localhost:4020 npx vite preview --port 4174

cd ../backend
npm run sim:api   # 79 simulações de API (S001–S076 e S101–S103)
npm run sim:ui    # 26 simulações na tela (S077–S100, S104 e S105)
```

Os arquivos estão em `backend/sim/`. Cada simulação é uma função pequena e legível. As variáveis `SIM_BASE`, `SIM_LIMITED` e `SIM_WEB` mudam os endereços.

## 8. As 105 simulações

✅ passou · ❌ falhou · ℹ️ passou com uma observação.

| # | Tipo | Área | O que verifica | Documento | Resultado |
|---|---|---|---|---|---|
| 001 | API | Contas e sessão | Cadastro aceitando as regras: token de 15 min, cookie protegido e handle federado | docs/03 §4, docs/10 A2, docs/12 | ✅ |
| 002 | API | Contas e sessão | Cadastro sem aceitar as regras é recusado e não cria conta | docs/12 §3 (accept_rules obrigatório) | ✅ |
| 003 | API | Contas e sessão | Campos inválidos e duplicidade (sem diferenciar maiúsculas) no cadastro | docs/03 §4, schema CITEXT | ✅ |
| 004 | API | Contas e sessão | Entrar por e-mail (qualquer caixa) e pelo usuário (legado); erro igual para senha errada e conta inexistente | docs/03 §4, docs/10 M3 | ✅ |
| 005 | API | Contas e sessão | Renovação pelo cookie: rotaciona o cookie e tolera a segunda aba na janela de 30 s | docs/10 A2 (refresh com rotação) | ✅ |
| 006 | API | Contas e sessão | Sair vale na hora (token e cookie) e "sair de todos os aparelhos" derruba todas as sessões | docs/10 A2, docs/03 §4, README (perfil) | ✅ |
| 007 | API | Convites | Convite de uso único: a pessoa nova segue quem convidou e o código não vale duas vezes | docs/08 §5 | ✅ |
| 008 | API | Convites | Código inexistente ou malformado não cria conta; no máximo 10 convites abertos | docs/08 §5 | ✅ |
| 009 | API | Contas e sessão | Corpo grande, JSON quebrado e rota inexistente respondem em JSON, sem vazar detalhes internos | docs/10 B1 | ✅ |
| 010 | API | Posts | Limite de 280 caracteres, texto aparado, vazio recusado | docs/03, README (posts de 280) | ✅ |
| 011 | API | Posts | Resposta forma a thread: conversation_id herdado, reply_count e ordem | docs/03, README (threads) | ✅ |
| 012 | API | Posts | Menção entra em /mentions (sem diferenciar maiúsculas), a própria menção não conta | docs/03 §4 (mentions) | ✅ |
| 013 | API | Posts | No máximo 10 menções por post | docs/14 P-1 | ✅ |
| 014 | API | Posts | Curtir é idempotente, descurtir não passa de zero | docs/03 §4, README | ✅ |
| 015 | API | Posts | Repost: um por pessoa, repost de repost aponta ao original, desfazer | docs/03, README | ✅ |
| 016 | API | Posts | Só o autor apaga; apagar resposta diminui o contador do post pai | docs/03 §4 | ✅ |
| 017 | API | Posts | Timeline Seguindo: ordem cronológica reversa e paginação por cursor sem repetição | README (exemplos de API), docs/03 | ✅ |
| 018 | API | Posts | Fan-out: post novo chega a quem segue; deixar de seguir tira da timeline; seguir a si mesmo é recusado | README (fan-out em Redis) | ✅ |
| 019 | API | Visitantes | Visitante lê tudo o que é público, mas nenhuma interação funciona e nada é alterado | README (visitantes só leem), docs/14 | ✅ |
| 020 | API | Visitantes | Posts de conta suspensa somem para todos, inclusive visitantes | docs/11 §2 (hydrate) | ✅ |
| 021 | API | Perfis | Seguir e deixar de seguir atualiza contadores, listas e relação; busca de pessoas | docs/03 §4 | ✅ |
| 022 | API | Moderação | Silenciar: some dos feeds, continua aberto de propósito, é privado e dá para desfazer | docs/11 §1 e §2 | ✅ |
| 023 | API | Moderação | Bloquear vale nos dois sentidos: desfaz follows, impede interações e esconde os posts; desbloquear libera | docs/11 §1 e §2 | ✅ |
| 024 | API | Moderação | Denúncia: motivos, validações, duplicata e denúncia de si mesma | docs/11 §2 (denúncias) | ✅ |
| 025 | API | Moderação | Denunciar um repost denuncia o original; o texto do post fica copiado na denúncia | docs/11 §2 (denúncias) | ✅ |
| 026 | API | Moderação | Fila só para a moderação, com contagem de denúncias abertas; quem é denunciado nunca vê quem denunciou | docs/11 §1 e §2 | ✅ |
| 027 | API | Moderação | Remover post exige citar a regra; o post sai do ar e as outras denúncias do mesmo post são resolvidas | docs/12 §1 e §3 | ✅ |
| 028 | API | Moderação | Suspender: login 403 com o motivo, sessões caem na hora, conta some; reativar desfaz | docs/11 §2, docs/12 §3 | ✅ |
| 029 | API | Moderação | A moderação não suspende a si mesma nem outra conta da moderação | docs/11 §2 (proteções) | ✅ |
| 030 | API | Moderação | Recurso de post removido: um só, de 10 a 1000 caracteres; aceitar devolve o post com as curtidas | docs/12 §1 e §3 | ✅ |
| 031 | API | Moderação | Recurso de conta suspensa por e-mail e senha: aceito, a conta volta; negado, a suspensão fica | docs/12 §1 e §3 | ✅ |
| 032 | API | Regras da instância | Regras públicas sem login: as 7 padrão, com quem modera e a data da última edição | docs/12 §1 e §2 | ✅ |
| 033 | API | Regras da instância | Editar regras: só a moderação, mínimo 1 e máximo 15; regra retirada fica arquivada e as decisões antigas mantêm o texto | docs/12 §3 | ✅ |
| 034 | API | Moderação | Mensagens de bloqueada, silenciada e de conta suspensa no grupo: aviso, recolhida e aviso, sempre com o mesmo pts | docs/11 §2 (grupos e canais) | ✅ |
| 035 | API | Moderação | No máximo 20 denúncias por dia por pessoa | docs/11 §2 (limite de denúncias) | ✅ |
| 036 | API | Missões e token | Missões do dia: 4 (2 de engajamento + 2 de rede), mesma lista ao recarregar, painel coletivo, sem sequências nem ranking | docs/08 §2 e §4, docs/09 §1 | ✅ ℹ️ |
| 037 | API | Missões e token | "Apresente-se" vem primeiro para conta nova, paga 2 NWC uma vez e o saldo bate com o extrato | docs/08 §3, docs/09 §1 (extrato imutável) | ✅ |
| 038 | API | Missões e token | "Curta 5 posts": exige 3 pessoas diferentes; curtir os próprios posts não conta | docs/09 §2 (engajamento) | ✅ |
| 039 | API | Missões e token | "Comente 3 posts": respostas de pelo menos 15 caracteres, em posts de outras pessoas | docs/09 §2 (engajamento) | ✅ |
| 040 | API | Missões e token | Recompensar post: transfere 1 NWC, uma vez por post, nunca o próprio, nunca sem saldo | docs/09 §1 e §4 | ✅ |
| 041 | API | Missões e token | No máximo 20 recompensas por dia | docs/09 §1 (limites) | ✅ |
| 042 | API | Missões e token | Evaporação: conta parada 3 dias perde parte do saldo ao voltar; em 7 dias zera; rodar duas vezes não desconta duas vezes | docs/09 (Evaporação) | ✅ |
| 043 | API | Missões e token | Pular missão não custa nada, esconder missões funciona, tempo no app conta 1 minuto a cada 55 s e pode ser desligado | docs/08 §2, docs/09 §3 | ✅ |
| 044 | API | Missões e token | "Abra um espaço": só um grupo conta (canal de transmissão não) e paga 4 NWC | docs/08 §3 | ✅ |
| 045 | API | Missões e token | "Traga alguém de confiança": conta quando o convite é usado e paga 4 NWC | docs/08 §3 e §5 | ✅ |
| 046 | API | Brasil em dados | 5 indicadores com os últimos números conferidos e 5 anos de histórico, abertos a visitantes | docs/13 §13, README | ✅ |
| 047 | API | Brasil em dados | Cada origem traz publicação, data e links de conferência; o que não foi conferido aparece como tal (nada inventado) | docs/13 §13 | ✅ |
| 048 | API | Brasil em dados | Indicador inexistente é recusado; forçar atualização é só da moderação e não apaga o que foi conferido | docs/13 §12 | ✅ |
| 049 | API | Federação | WebFinger e NodeInfo: handle usuario@instancia, domínio e formato validados | README, docs/03 §4 | ✅ |
| 050 | API | Federação | Ator e outbox ActivityStreams: Create/Note com o texto escapado, até 20, sem reposts | docs/03 §4, docs/14 F-1 | ✅ |
| 051 | API | Segurança e limites | Cabeçalhos de proteção na API, nada de x-powered-by, login sem cache e CORS só para a origem do app | docs/10 M7 | ✅ |
| 052 | API | Segurança e limites | Parâmetros estranhos (aspas, ponto e vírgula, números gigantes, unicode) nunca derrubam a API nem mexem no banco | docs/10 | ✅ |
| 053 | API | Segurança e limites | Limite de pedidos: cabeçalhos no padrão do X, contador por pessoa que desce 1 a cada pedido | docs/10 A3 | ✅ |
| 054 | API | Segurança e limites | Senhas erradas: 10 por conta bloqueiam a 11ª tentativa (mesmo com a senha certa); outra conta segue livre | docs/14 A-4 | ✅ |
| 055 | API | Algoritmo "Para você" | Especificação pública do algoritmo: 5 fatores, popularidade em zero, código-fonte aberto | docs/07, README | ✅ |
| 056 | API | Algoritmo "Para você" | Candidatos: só com login, sem os próprios posts nem reposts, com quem a pessoa segue | docs/07 §2.10 | ✅ |
| 057 | API | Algoritmo "Para você" | O servidor não calcula o feed: /feed/interesses responde 410 e aponta para os candidatos | docs/07 §2.10 (documento 03 §4 ainda lista a rota) | ✅ ℹ️ |
| 058 | API | Algoritmo "Para você" | O servidor só guarda missões e contagem de tempo; qualquer campo do algoritmo é recusado | docs/07 §2.10 | ✅ |
| 059 | API | Algoritmo "Para você" | Curtir, repostar, responder e "menos disto" não deixam rastro de aprendizado no servidor | docs/07 §2.10 | ✅ |
| 060 | API | Algoritmo "Para você" | Conta antiga: levar o algoritmo ao aparelho apaga a cópia do servidor e mantém missões e tempo | docs/07 §2.10 (contas antigas) | ✅ |
| 061 | API | Algoritmo "Para você" | Ranking local (mesmo código do navegador): tópico declarado sobe, silenciado some, palavra-chave e explicação somam a nota | docs/07 §2 (nota = soma das contribuições) | ✅ |
| 062 | API | Algoritmo "Para você" | Aprendizado: sinais do documento, meia-vida de 14 dias e limites | docs/07 §2.6 | ✅ |
| 063 | API | Canais e grupos | Criar canal e grupo: papel de dono, slug validado e único sem diferenciar maiúsculas | docs/02, docs/03 §4 | ✅ |
| 064 | API | Canais e grupos | Canal de transmissão: só dono e admins publicam; membro e visitante não | docs/02 (broadcast), docs/03 | ✅ |
| 065 | API | Canais e grupos | Grupo: todos os membros publicam, não-membro não, limites de tamanho | docs/02, docs/03 | ✅ |
| 066 | API | Canais e grupos | pts sequencial e sem buracos mesmo com 10 mensagens ao mesmo tempo | docs/02 (pts), docs/03 | ✅ |
| 067 | API | Canais e grupos | /difference devolve só o que falta; lacuna grande pede recarregar (too_long) | README (exemplo difference), docs/02 | ✅ |
| 068 | API | Canais e grupos | Histórico paginado: mais recentes primeiro, cursor sem repetição | docs/02 (getHistory), docs/03 | ✅ |
| 069 | API | Canais e grupos | Reações: só emojis da lista, até 3 por pessoa, agregação e remoção | docs/14 C-3 | ✅ |
| 070 | API | Canais e grupos | Papéis: dono promove e rebaixa admins; ninguém muda o dono; dono não sai; membro sai e perde o acesso | docs/02, docs/03 §4 | ✅ |
| 071 | API | Canais e grupos | Remover e banir: admin remove membro, banido não entra, desfazer a remoção libera | docs/14 C-2 | ✅ |
| 072 | API | Canais e grupos | Grupo é só de quem entrou; canal de transmissão tem prévia para quem está logado | docs/14 C-1, README | ✅ |
| 073 | API | Tempo real | Mensagem chega ao vivo a quem assinou; quem não é membro não assina o grupo; cancelar a assinatura para os eventos | docs/03 (Socket.io), docs/14 C-1 | ✅ |
| 074 | API | Tempo real | Conexão exige token válido e no máximo 10 conexões por conta | docs/14 C-4 | ✅ |
| 075 | API | Tempo real | Post novo chega a quem segue (timeline:new), menção e resposta geram notificação; quem não segue não recebe | README (tempo real), docs/03 §4 | ✅ |
| 076 | API | Segurança e limites | Limite de tentativas de entrada por IP: depois de 20, responde 429 com o tempo de espera | docs/10 A3, docs/14 A-3 | ✅ |
| 077 | Tela | Cadastro e entrada | Cadastro pela tela: regras visíveis, aceite obrigatório, erro de senha curta e entrada na timeline | docs/12 §1 (entrar é aceitar) | ✅ |
| 078 | Tela | Cadastro e entrada | Entrar: erro claro com senha errada, mostrar/ocultar senha, sair, recarregar mantém a sessão | docs/10 A2, README | ✅ ℹ️ |
| 079 | Tela | Visitante | Visitante lê a timeline e a thread; curtir pede login e volta ao mesmo lugar; sem botão de novo post | README (visitantes só leem) | ✅ |
| 080 | Tela | Posts na tela | Novo post pelo botão flutuante: contador de caracteres, 281 bloqueia o envio e o post aparece | README, docs/03 | ✅ |
| 081 | Tela | Posts na tela | Responder na thread: a resposta aparece na árvore e o campo limpa | README (threads) | ✅ |
| 082 | Tela | Posts na tela | Curtir e repostar na timeline: botões alternam, contadores mudam, desfazer volta ao estado anterior | README | ✅ |
| 083 | Tela | Token na tela | Recompensar pelo botão da moeda: saldo cai 1, extrato registra e a carteira explica a evaporação | docs/09 | ✅ |
| 084 | Tela | Algoritmo na tela | "Para você" carrega no aparelho, explica cada post e "Menos disto" esconde o post e persiste | docs/07 §2 | ✅ |
| 085 | Tela | Algoritmo na tela | Meu algoritmo: salvar fica só no aparelho, sobrevive a recarregar e a sair/entrar, e outra conta não herda | docs/07 §2.10 | ✅ |
| 086 | Tela | Perfis na tela | Explorar: a busca de pessoas acha por parte do nome e leva ao perfil | docs/03 §4 | ✅ |
| 087 | Tela | Perfis na tela | Perfil: Seguir e Seguindo alternam e os contadores acompanham | docs/03 §4 | ✅ |
| 088 | Tela | Moderação na tela | Silenciar pelo menu "⋯": o cartão vira aviso com Desfazer e o post volta ao desfazer | docs/11 §1 | ✅ |
| 089 | Tela | Moderação na tela | Denunciar pelo menu: motivo, envio, confirmação e o acompanhamento em "Privacidade e dados" | docs/11 §1, docs/12 | ✅ |
| 090 | Tela | Moderação na tela | Bloquear pelo menu: pede confirmação, o post some, o perfil avisa e dá para desbloquear | docs/11 §1 | ✅ |
| 091 | Tela | Moderação na tela | Fila da moderação: remover sem escolher a regra é recusado; com a regra, o post sai e quem denunciou vê "Acatada" | docs/12 §1 | ✅ |
| 092 | Tela | Moderação na tela | Conta suspensa: a tela de entrar mostra o motivo e permite recorrer; depois mostra "em análise" | docs/12 §1 | ✅ |
| 093 | Tela | Tempo real na tela | Tempo real: mensagem de canal sem recarregar, reação e o aviso "Mostrar 1 post novo" na timeline | docs/02, README (como rodar) | ✅ |
| 094 | Tela | Tempo real na tela | Grupo fechado: quem não entrou vê o aviso; entra e lê; o dono remove a pessoa e ela perde o acesso | docs/14 C-1 e C-2 | ✅ |
| 095 | Tela | Missões na tela | Missões: 4 cartões, pular tira a cobrança, convite gera o link e "A rede, junta" aparece sem ranking | docs/08 §2 e §4 | ❌ |
| 096 | Tela | Brasil na tela | Aba Brasil (visitante): 5 cartões, selo, data da conferência, histórico de 5 anos e links; sem botão de atualizar | docs/13 §13 | ✅ ℹ️ |
| 097 | Tela | Regras na tela | Regras da instância abertas a visitantes: 7 regras, quem modera, e a moderadora vê o botão de editar | docs/12 §1 | ✅ |
| 098 | Tela | Layout | Sem rolagem horizontal em 320, 390, 768 e 1280 px; menu inferior no celular e coluna lateral no desktop | README (mobile first) | ✅ |
| 099 | Tela | Acessibilidade | Botões, campos e imagens têm nome acessível; há região principal, idioma e títulos; Tab percorre o login na ordem | boas práticas (WCAG 2.1 A) | ❌ |
| 100 | Tela | Navegação e erros | Abas do celular levam às telas certas; rota inexistente e falta de rede mostram aviso, não tela vazia | README (navegação), usabilidade | ✅ ℹ️ |
| 101 | API | Privacidade e dados | Baixar meus dados: arquivo com posts, edições, curtidas, seguidas e carteira; sem segredos nem quem denunciou | docs/16 §1 | ✅ |
| 102 | API | Privacidade e dados | Excluir a conta: senha conferida, tudo some, números dos outros recontados, @ reservado e convite que não volta | docs/16 §2 | ✅ |
| 103 | API | Privacidade e dados | Termo do piloto: público, aceite obrigatório no cadastro, versão velha recusada; conta com termo antigo aceita depois | docs/16 §4 | ✅ |
| 104 | Tela | Privacidade na tela | Privacidade e dados: resumo de quem vê o quê, baixar o arquivo, excluir com senha errada e certa | docs/16 §1–§3 | ✅ |
| 105 | Tela | Privacidade na tela | Termo do piloto: página pública /termo; conta com termo antigo vê o termo antes do app, "Não aceito" mostra as saídas, aceitar abre o app | docs/16 §4 | ✅ |
