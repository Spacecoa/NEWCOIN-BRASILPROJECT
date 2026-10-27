# Metodologia de desenvolvimento com Claude Code

O protótipo foi construído em incrementos pequenos e verificáveis, seguindo a estratégia da Fase 5: **componentes isolados, cada um com testes, antes de passar ao próximo.**

## Ordem de construção

| Passo | Pedido (resumido) | Verificação |
|---|---|---|
| 1 | Schema SQL com Snowflake, `conversation_id`, repost como post e `pts` por canal | `npm run migrate` |
| 2 | Gerador Snowflake + paginação por cursor | `test/unit/*` (13 testes) |
| 3 | `POST /api/posts` com `{ text, reply_to_id }` retornando o post e o autor | `test/posts.test.js` |
| 4 | Home timeline com fan-out em Redis e fallback SQL | `test/timeline.test.js` em 3 modos |
| 5 | Canais com `pts`, `/difference` e reações | `test/channels.test.js` (incluindo concorrência) |
| 6 | Socket.io autenticado por JWT | `test/realtime.test.js` |
| 7 | Componente `Feed` consumindo `GET /api/...` com paginação infinita pelo ID do último post | `Feed.test.jsx` |
| 8 | `Composer`, `PostCard`, Thread, Perfil, Canais | testes de componente + build |
| 9 | Teste ponta a ponta no navegador (Playwright) com dois usuários simultâneos | manual, registrado no relatório |

## Exemplos de prompts eficazes

> "Crie um componente React chamado `Feed` que consuma um endpoint GET e renderize posts com autor, timestamp relativo, texto e botões de like/reply. Use paginação infinita com `until_id` = `meta.next_token`. Escreva testes com fetch simulado verificando que a 2ª página usa o cursor da 1ª."

> "Implemente `POST /api/posts` recebendo `{ text, reply_to_id }`. Em uma transação: trave o pai com `FOR UPDATE`, herde `conversation_id`, incremente `reply_count`, insira as menções. Retorne `{ data, includes.users }`. Escreva testes de integração contra um Postgres real."

> "Este teste falha com: <log>. Corrija só a causa, sem alterar o comportamento testado."

## Dicas

- Peça **contratos** (formato da resposta, códigos de erro) antes da implementação.
- Para cache, peça um teste que rode **com e sem** o cache e compare os resultados.
- Para concorrência (contadores, `pts`), peça um teste com `Promise.all` de N operações.
- Mantenha as rotas finas (validar → serviço → responder): fica mais fácil pedir mudanças cirúrgicas.
