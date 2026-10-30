# Ágora: instruções para o Claude Code

Protótipo acadêmico de rede social federável (pesquisa). Uso local ou em rede privada; nada de scraping, chamadas às APIs reais do X ou do Telegram, ataques de negação de serviço ou dados de pessoas reais. Não escreva scripts que forjem tokens de acesso ou inundem conexões.

## Idioma

Código comentado, documentos, mensagens de commit e textos do app em português do Brasil, em linguagem simples.

## Antes de cada PR

- `cd backend && npm test` e `cd frontend && npm test` passando (o CI do GitHub roda os mesmos testes, mas a conta pode não liberar o Actions).
- Para mudanças que o usuário vê: `npm run sim:api` e `npm run sim:ui` em `backend/` (ver `docs/15`).
- Documentos atualizados junto com o código (README, `docs/03` para rotas, e o documento da área).

## Depois de cada PR com merge: atualizar os artefatos

Pedido do dono do projeto. Depois de **cada** merge, deixe os dois artefatos compatíveis com a `main`:

1. **No próprio PR, antes do merge:** se a mudança altera o que o app faz, cubra-a nos roteiros de `tools/artefatos/` e na demo (`demo/index.html`), e revise os textos de `build.py` e `tpl.html` (ver `tools/artefatos/README.md`).
2. **Depois do merge:** atualize a `main` local e rode `tools/artefatos/run.sh`. Todo passo tem que passar.
3. Publique `analise-agora.html` em https://claude.ai/artifact/MUrJ25cMkeVGGzahjhMSxR ("Ágora por dentro") e `agora-demo.html` em https://claude.ai/artifact/1KYADm2kxRoJqg8rsX6H9d ("Ágora em ação"), passando o link como `url` para manter o mesmo endereço.
4. Diga ao usuário o que mudou em cada artefato.
