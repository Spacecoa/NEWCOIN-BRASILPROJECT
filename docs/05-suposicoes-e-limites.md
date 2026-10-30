# Suposições, limites e decisões registradas

Todo comportamento "inspirado em" uma plataforma tem uma suposição por trás. Esta lista registra cada uma para facilitar a auditoria.

## Suposições sobre o X/Twitter

| # | Suposição | Base | Confiança |
|---|---|---|---|
| X1 | A home "Seguindo" inclui os próprios posts e os reposts de quem você segue | Comportamento observado no app | Alta |
| X2 | A home é montada por fan-out na escrita em caches com teto de ~800 IDs, com tratamento especial para contas muito seguidas | Palestras públicas de engenharia (2012–2013) e o limite de 800 documentado na API | Média: a arquitetura atual pode ter mudado |
| X3 | Posts novos não entram sozinhos na tela; aparece um aviso "Mostrar N posts" | Comportamento observado | Alta |
| X4 | Repostar um repost conta no post original | Comportamento observado e semântica de `referenced_tweets` | Alta |
| X5 | Limites de 180 req/15 min (timeline), 900 (posts do usuário) e ~300 posts/3 h | Documentação histórica da API v2 | Baixa a média: mudam com o plano e com o tempo |
| X6 | `conversation_id` é o ID do post raiz | Documentação v2 | Alta |
| X7 | Apagar um post apaga os reposts dele, e as respostas continuam existindo | Comportamento observado | Média. No protótipo: reposts somem (`CASCADE`); replies ficam com `reply_to_id = NULL` mas mantêm o `conversation_id` |

## Suposições sobre o Telegram

| # | Suposição | Base | Confiança |
|---|---|---|---|
| T1 | Canal (broadcast) e supergrupo são o mesmo tipo de objeto, com flags diferentes | Schema TL (`channel.broadcast` / `megagroup`) | Alta |
| T2 | Cada canal tem seu `pts`, e a recuperação de lacunas usa `updates.getChannelDifference` | Documentação "Working with updates" | Alta |
| T3 | Uma diferença grande demais gera `channelDifferenceTooLong` e o cliente recarrega | Documentação | Alta. **O limite de 100 do protótipo é arbitrário** |
| T4 | Ler um canal público não exige ser membro | Comportamento observado | Alta. No protótipo, **todos os canais são públicos** para usuários logados |
| T5 | Layer 225 é a camada vigente | Informado no enunciado | **Não verificada** |
| T6 | Regras de `upload.getFile` (múltiplos de 4 KB, máximo de 1 MB, sem cruzar fronteira de 1 MB) | Documentação "Uploading and downloading files" | Alta |

## Decisões do protótipo (e o que elas simplificam)

1. **Sem mídia, quotes, enquetes nem edição de post.** Simplifica o modelo. Os campos e tabelas necessários estão descritos na arquitetura. Silenciar e bloquear existem desde então (ver [`docs/11`](11-moderacao.md)).
2. **Contagem simples de caracteres** (`char_length`). O X usa "caracteres ponderados" (alguns contam 2, URLs contam 23).
3. **Sessão.** Token de acesso de 15 min só na memória da aba, e renovação por cookie `HttpOnly` + `SameSite=Strict` com rotação (ver `docs/10` §4.3). Em HTTPS, ligue `COOKIE_SECURE=true`.
4. **Sem verificação de e-mail nem 2FA.** A recuperação de senha existe, mas o e-mail não sai de verdade: com `MAIL_TRANSPORT=log` (o único transporte), a mensagem com o link vai para o log do servidor. Um serviço de e-mail real fica para a produção.
5. **Fan-out síncrono** dentro da requisição. Bom até milhares de seguidores; acima disso, usar uma fila.
6. **Reconstrução da timeline sem lock.** Um post criado entre o `SELECT` e o `RPUSH` da reconstrução pode ficar fora do cache até ele expirar (TTL de 1 h) ou ser invalidado. O limite está documentado e é aceito.
7. **`post:deleted` é enviado a todos os conectados.** Em escala, seria só para a audiência.
8. **A busca de usuários usa `ILIKE`.**
9. **A federação é só leitura** e não é assinada. As URLs usam `http://` porque o ambiente é local.
10. **Rate limits desligados nos testes de integração** (`DISABLE_RATE_LIMIT=1`), com um teste dedicado ao limitador.

## Limites éticos e legais respeitados

- Nenhuma chamada às APIs reais do X ou do Telegram. Nenhum scraping. Nenhum código proprietário.
- Os dados do seed são inteiramente fictícios (domínio `exemplo.test`, reservado para testes).
- O protótipo é para uso local ou em rede privada, sem fins comerciais e sem distribuição pública.
