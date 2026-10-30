# Artefatos do projeto

Dois artefatos publicados no claude.ai acompanham o código:

| Artefato | Link | Gerado por |
|---|---|---|
| **Ágora por dentro**: o app percorrido de ponta a ponta, com telas e o que falta | https://claude.ai/artifact/MUrJ25cMkeVGGzahjhMSxR | `walk.mjs`, `e2e.cjs`, `shots.cjs`, `build.py`, `tpl.html` |
| **Ágora em ação**: a demo interativa | https://claude.ai/artifact/1KYADm2kxRoJqg8rsX6H9d | `demo.py` (a partir de `demo/index.html`) |

Os links são privados: só abre quem recebeu acesso.

## Como gerar

```bash
docker compose up -d                 # Postgres e Redis
tools/artefatos/run.sh /tmp/agora-artefatos
```

O script roda os testes, sobe o app (API em :4000, uma segunda API com acesso de 5 s em :4030 e os frontends em :4173 e :4175), percorre o passo a passo e tira as telas. No fim, deixa `analise-agora.html` e `agora-demo.html` prontos para publicar no mesmo link. **Ele roda o seed, que apaga o banco de desenvolvimento.**

| Arquivo | O que faz |
|---|---|
| `walk.mjs` | Chamadas reais à API, área por área (contas, visitantes, posts, imagens, editar e citar, busca, notificações, feeds, canais, missões, NWC, federação, segurança, moderação, Brasil) |
| `e2e.cjs` | Sessão no navegador: cookie protegido, renovação sozinha, sair de um ou de todos os aparelhos, visitante que vai ao login e volta |
| `shots.cjs` | 18 telas no celular (390 × 844) |
| `build.py` + `tpl.html` | Monta a página com os resultados. Os textos de resumo, utilidade e "o que falta" são escritos à mão nesses dois arquivos |
| `demo.py` | Tira o esqueleto HTML de `demo/index.html`, que o publicador acrescenta sozinho |

## Quando uma mudança entra

No mesmo PR da mudança, antes do merge:
1. Se ela alterou o que o app faz, ajuste `walk.mjs` (ou `e2e.cjs` e `shots.cjs`) para cobrir a função nova e revise os textos de `build.py` e `tpl.html`.
2. Se ela aparece na tela, leve-a também para `demo/index.html`.

Depois do merge:
3. Rode `run.sh` na `main` atualizada: todo passo tem que passar. Uma falha aponta o app ou o roteiro; investigue antes de publicar.
4. Publique os dois arquivos no mesmo link de cada artefato.
