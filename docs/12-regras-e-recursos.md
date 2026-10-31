# Regras da instância e recursos

**Data:** 28/10/2026 · **Complementa:** [`docs/11-moderacao.md`](11-moderacao.md)

## 1. Em linguagem simples

A moderação precisa de um combinado claro. Sem regras escritas, qualquer decisão parece arbitrária. Sem um jeito de contestar, um erro da moderação vira injustiça permanente. Por isso, a partir de agora:

1. **As regras são públicas.** Qualquer pessoa lê em **Regras da instância**, mesmo sem conta. A página mostra quem modera e quando as regras mudaram.
2. **Entrar é aceitar.** O cadastro mostra as regras e só continua com "Li e aceito as regras". O app guarda quando a pessoa aceitou.
3. **Toda punição cita uma regra.** Para remover um post ou suspender uma conta, quem modera precisa escolher qual regra foi quebrada. Arquivar uma denúncia não precisa.
4. **Quem foi afetado fica sabendo e pode recorrer uma vez por decisão:**
   - **Post removido:** aparece em *Perfil › Privacidade e dados › Decisões sobre sua conta*, com o texto, a regra e a nota da moderação. Ali há o botão **Recorrer**.
   - **Conta suspensa:** a pessoa não consegue entrar, então a tela de entrar mostra o motivo (regra e nota) e um campo para recorrer, usando o mesmo e-mail e senha.
5. **A moderação decide o recurso.** Ela pode aceitar, e então a decisão é desfeita (o post volta ou a conta é reativada), ou manter a decisão. Nos dois casos escreve uma nota que a pessoa vê.

**Por que o post removido pode voltar.** Remover deixou de apagar: o post só fica escondido de todos. Assim, um recurso aceito devolve o post exatamente como era, com curtidas e respostas.

**Por que regras antigas não somem.** Se a moderação retirar uma regra, ela fica arquivada. Decisões antigas continuam mostrando o texto que valia na época.

## 2. Regras padrão

Uma instância nova nasce com 7 regras, que a moderação pode editar em **Regras › Editar regras**:

1. Respeite as pessoas
2. Sem discurso de ódio
3. Sem golpes nem se passar por outra pessoa
4. Sem spam
5. Proteja a privacidade
6. O NWC não é dinheiro
7. Nada ilegal

O texto completo está em `backend/src/services/rules.js` (`DEFAULT_RULES`).

## 3. Regras técnicas

- **Tabela `instance_rules`:**
  - a posição define a numeração;
  - regra retirada recebe `archived_at` e não é apagada;
  - `PUT /api/moderacao/regras` substitui a lista inteira: itens com `id` são atualizados, itens sem `id` são criados e os ausentes são arquivados;
  - mínimo de 1 regra e máximo de 15.
- **Cadastro:** `accept_rules: true` é obrigatório (400 sem ele). O momento do aceite fica em `users.rules_accepted_at`.
- **Decisões:**
  - `remover_post` e `suspender` exigem `rule_id` de uma regra em vigor;
  - a regra fica gravada na denúncia (quem denunciou vê) e numa **sanção** (`sanctions`), que é o registro do que aconteceu com a pessoa afetada.
- **Remoção reversível:**
  - `posts.removed_at` esconde o post em `hydrate()`, no "Para você" e nas sugestões das missões;
  - o post removido também não aceita resposta, curtida, repost nem recompensa (404);
  - o aviso `post:deleted` continua saindo em tempo real.
- **Recursos:**
  - um por sanção (`appeal_status` aberto → aceito ou negado);
  - de 10 a 1000 caracteres;
  - sanção já desfeita não aceita recurso.
- **Recurso de conta suspensa:**
  - `POST /api/recursos/suspensao` confere e-mail e senha com o mesmo custo e a mesma mensagem do login, para não revelar quem tem conta;
  - limite de 10 pedidos a cada 15 minutos por IP.
- **Login de conta suspensa:**
  - com a senha certa, responde 403 com `suspension: { since, rule, note, appeal_status, appeal_note, can_appeal }`;
  - com a senha errada, a resposta é 401 e não diz nada sobre suspensão.
- **Desfazer:** aceitar o recurso ou reativar a conta pela moderação marca `reverted_at` na sanção.

## 4. API

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/api/instancia/regras` | todos | Regras em vigor, quem modera, última atualização |
| PUT | `/api/moderacao/regras` | moderação | Substitui a lista (ordem = numeração) |
| GET | `/api/conta/decisoes` | logado | Decisões sobre a própria conta, com a regra |
| POST | `/api/conta/decisoes/:id/recurso` | logado | `{ text }` · um recurso por decisão |
| POST | `/api/recursos/suspensao` | sem login | `{ email, password, text }` |
| GET | `/api/moderacao/recursos?status=aberto\|decidido` | moderação | Fila de recursos |
| POST | `/api/moderacao/recursos/:id/decidir` | moderação | `{ decision: aceitar \| negar, note? }` |
| POST | `/api/moderacao/denuncias/:id/resolver` | moderação | agora com `rule_id` (obrigatório para remover/suspender) |

## 5. Como foi verificado

- **Backend:** 9 testes novos (`test/rules.test.js`), cobrindo:
  - regras públicas e cadastro com aceite;
  - edição só pela moderação, com arquivamento;
  - decisão sem regra ou com regra arquivada recusada;
  - post removido inacessível e devolvido ao aceitar o recurso;
  - recurso único;
  - conta suspensa que vê o motivo e recorre com e-mail e senha, recurso aceito e negado;
  - reativação que desfaz a sanção.

  Os testes encontraram um bug, já corrigido: o id da regra perdia precisão dentro do JSON montado pelo banco.
- **Frontend:** 2 testes novos (cadastro com aceite, tela de conta suspensa). Um deles achou um bug, já corrigido: o formulário de recurso ficava dentro do formulário de login.
- **Navegador, com o app real:**
  - ler as regras sem conta e se cadastrar só com o aceite;
  - remover um post sem regra é recusado na tela; com a regra 1, funciona;
  - suspender a conta de spam com a regra 3;
  - a conta suspensa vê o motivo e recorre;
  - a autora do post removido vê a decisão e recorre;
  - a moderação aceita um recurso (o post volta) e nega o outro;
  - a moderação adiciona uma regra.

## 6. Limites

- Recurso é decidido pela mesma moderação (em instâncias pequenas, muitas vezes a mesma pessoa que decidiu). A tela mostra quem tomou a decisão original; o ideal é outra pessoa revisar.
- Não há notificação quando sai uma decisão ou um recurso. A pessoa vê ao abrir a página.
- O histórico de mudanças nas regras guarda só a data da última edição de cada regra, não as versões anteriores do texto.
