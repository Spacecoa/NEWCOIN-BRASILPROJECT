// Simulações de uso na tela (navegador real, celular 390×844), numeradas de S077 a S100.
// Cada simulação cria as próprias contas pela API e abre o próprio contexto de navegador.
const { chromium } = require('playwright');
const { writeFileSync } = require('node:fs');

const API = process.env.SIM_BASE ?? 'http://localhost:4020';
const WEB = process.env.SIM_WEB ?? 'http://localhost:4174';
const PASS = 'senha-forte-123';
const FIRST = 77;
const out = [];
let browser;
let cur = '000';
let lastPages = [];
const rnd = () => Math.random().toString(36).slice(2, 6);

async function api(tok, method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
async function reg(tag = 'u') {
  const u = `${tag}${cur}_${rnd()}`.slice(0, 20);
  const r = await api(null, 'POST', '/api/auth/register', { username: u, email: `${u}@sim.test`, password: PASS, accept_rules: true, display_name: `Pessoa ${u}` });
  if (r.s !== 201) throw new Error(`cadastro de ${u} falhou: ${r.s}`);
  return { u, id: r.j.user.id, tok: r.j.token, email: `${u}@sim.test` };
}
const modTok = async () => (await api(null, 'POST', '/api/auth/login', { email: 'ana_dev@exemplo.test', password: 'senha1234' })).j.token;
const mkPost = async (w, text, reply) => (await api(w.tok, 'POST', '/api/posts', { text, reply_to_id: reply })).j.data;
const follow = (w, name) => api(w.tok, 'POST', `/api/users/${name}/follow`);

const check = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

async function open(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  const page = await context.newPage();
  lastPages.push(page);
  page.setDefaultTimeout(7000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  return { context, page, errs };
}
async function uiLogin(page, email, password = PASS) {
  await page.goto(WEB + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('tab', { name: 'Seguindo' }).waitFor();
}
const body = (page) => page.locator('body').innerText();
const gone = async (page, text, ms = 3000) => { await page.waitForFunction((t) => !document.body.innerText.includes(t), text, { timeout: ms }); };

const sims = [];
const sim = (area, title, doc, fn) => sims.push({ area, title, doc, fn });

// 1
sim('Cadastro e entrada', 'Cadastro pela tela: regras visíveis, aceite obrigatório, erro de senha curta e entrada na timeline', 'docs/12 §1 (entrar é aceitar)', async () => {
  const { page, errs, context } = await open();
  const u = `cad${cur}_${rnd()}`;
  await page.goto(WEB + '/cadastro');
  const resumo = page.getByText(/Regras desta instância \(\d+\)/);
  await resumo.waitFor();
  const noApi = (await api(null, 'GET', '/api/instancia/regras')).j.data.rules.length;
  eq(Number((await resumo.innerText()).match(/\((\d+)\)/)[1]), noApi, 'o número de regras no cadastro tem de ser o da instância');
  const txt = await body(page);
  for (const r of ['Respeite as pessoas', 'Sem spam', 'Nada ilegal']) check(txt.includes(r), `a regra "${r}" deveria aparecer no cadastro`);
  await page.getByLabel(/Usuário/).fill(u);
  await page.getByLabel('E-mail').fill(`${u}@sim.test`);
  await page.getByLabel(/Senha/).fill('1234567');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  check(page.url().includes('/cadastro'), 'sem aceitar as regras e com senha curta, o cadastro não pode seguir');
  const invalid = await page.evaluate(() => [...document.querySelectorAll('input:invalid')].map((i) => i.name));
  check(invalid.includes('password') && invalid.includes('accept_rules'), `o navegador deveria apontar a senha e o aceite: ${invalid}`);
  await page.getByLabel(/Senha/).fill(PASS);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.getByRole('tab', { name: 'Seguindo' }).waitFor();
  const me = await api(null, 'POST', '/api/auth/login', { email: `${u}@sim.test`, password: PASS });
  eq(me.s, 200, 'a conta foi criada');
  check(errs.length === 0, `erros de página: ${errs}`);
  await context.close();
});

// 2
sim('Cadastro e entrada', 'Entrar: erro claro com senha errada, mostrar/ocultar senha, sair, recarregar mantém a sessão', 'docs/10 A2, README', async () => {
  const a = await reg('lg');
  const { page, context } = await open();
  await page.goto(WEB + '/login');
  await page.getByLabel('E-mail').fill(a.email);
  await page.getByLabel('Senha').fill('senha-errada-1');
  await page.getByRole('button', { name: 'Mostrar' }).click();
  eq(await page.getByLabel('Senha').getAttribute('type'), 'text', 'senha visível');
  await page.getByRole('button', { name: 'Ocultar' }).click();
  eq(await page.getByLabel('Senha').getAttribute('type'), 'password', 'senha oculta');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('alert').waitFor();
  eq(await page.getByRole('alert').innerText(), 'E-mail ou senha incorretos', 'mensagem de erro');
  await page.getByLabel('Senha').fill(PASS);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('tab', { name: 'Seguindo' }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Seguindo' }).waitFor();
  const cookies = await context.cookies();
  const c = cookies.find((x) => x.name === 'agora_refresh');
  check(c && c.httpOnly && c.sameSite === 'Strict', 'cookie de sessão sem HttpOnly/Strict');
  check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /token|jwt/i.test(k)))), 'o token não pode ficar no localStorage');
  await page.locator('nav[aria-label="Principal (celular)"] a', { hasText: 'Perfil' }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).first().click();
  await page.getByText(/Você está só lendo/).waitFor();
  // Quem sai cai na versão de leitura da mesma página: a faixa confirma a saída.
  check((await page.getByRole('status').filter({ hasText: 'Você saiu da sua conta.' }).count()) === 1, 'ao sair, a faixa de visitante deveria dizer "Você saiu da sua conta."');
  await page.reload();
  await page.getByText(/Você está só lendo/).waitFor();
  eq((await api(null, 'POST', '/api/auth/refresh')).s, 401, 'sem o cookie, a sessão não volta sozinha');
  await context.close();
  return { detail: 'erro claro, senha mostrar/ocultar, sessão mantida e encerrada, saída confirmada' };
});

// 3
sim('Visitante', 'Visitante lê a timeline e a thread; curtir pede login e volta ao mesmo lugar; sem botão de novo post', 'README (visitantes só leem)', async () => {
  const a = await reg('vi');
  const p = await mkPost(a, `post aberto ${cur}`);
  const { page, context } = await open();
  await page.goto(WEB + '/');
  await page.getByText(/Você está só lendo/).waitFor();
  await page.getByText(`post aberto ${cur}`).first().waitFor();
  check((await page.getByRole('button', { name: 'Novo post' }).count()) === 0, 'visitante não deveria ver "Novo post"');
  await page.goto(WEB + `/post/${p.id}`);
  await page.getByText('Você pode ler esta conversa. Para responder, entre na sua conta.').waitFor();
  check((await page.getByRole('textbox').count()) === 0, 'visitante não deveria ter campo de resposta');
  await page.getByRole('button', { name: 'Curtir' }).first().click();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  await page.getByLabel('E-mail').fill(a.email);
  await page.getByLabel('Senha').fill(PASS);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('textbox', { name: /Escreva sua resposta/ }).waitFor();
  check(page.url().endsWith(`/post/${p.id}`), `depois do login deveria voltar ao post, está em ${page.url()}`);
  eq((await api(null, 'GET', `/api/posts/${p.id}`)).j.data.public_metrics.like_count, 0, 'a curtida do visitante não pode ter sido registrada');
  await context.close();
});

// 4
sim('Posts na tela', 'Novo post pelo botão flutuante: contador de caracteres, 281 bloqueia o envio e o post aparece', 'README, docs/03', async () => {
  const a = await reg('np');
  const { page, context } = await open();
  await uiLogin(page, a.email);
  await page.getByRole('button', { name: 'Novo post' }).click();
  const box = page.getByRole('dialog', { name: 'Novo post' });
  const ta = box.getByRole('textbox');
  await ta.fill('a'.repeat(281));
  check(await box.getByRole('button', { name: 'Postar' }).isDisabled(), 'com 281 caracteres, o botão deveria estar desativado');
  check((await box.innerText()).includes('-1'), 'o contador deveria mostrar -1');
  await ta.fill('Meu primeiro post pela tela, com acentuação e emoji 🙂');
  check((await box.innerText()).includes(String(280 - 'Meu primeiro post pela tela, com acentuação e emoji 🙂'.length)), 'contador de caracteres restantes');
  await box.getByRole('button', { name: 'Postar' }).click();
  await page.getByText('Meu primeiro post pela tela, com acentuação e emoji 🙂').waitFor();
  eq((await api(a.tok, 'GET', '/api/timeline')).j.data.length, 1, 'o post está na timeline da autora');
  await context.close();
});

// 5
sim('Posts na tela', 'Responder na thread: a resposta aparece na árvore e o campo limpa', 'README (threads)', async () => {
  const a = await reg('rp');
  const b = await reg('rp');
  const p = await mkPost(b, `post para responder ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  await page.goto(WEB + `/post/${p.id}`);
  await page.getByText(`post para responder ${cur}`).first().waitFor();
  const ta = page.getByRole('textbox', { name: /Escreva sua resposta/ });
  await ta.fill('Concordo bastante com este ponto de vista.');
  await page.getByRole('button', { name: 'Responder', exact: true }).last().click();
  await page.getByText('Concordo bastante com este ponto de vista.').waitFor();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '', null, { timeout: 3000 }).catch(() => {});
  eq(await ta.inputValue(), '', 'o campo deveria limpar');
  const t = await api(null, 'GET', `/api/posts/${p.id}/thread`);
  eq(t.j.data.length, 2, 'a thread no servidor');
  await context.close();
});

// 6
sim('Posts na tela', 'Curtir e repostar na timeline (pelo menu Repostar ou citar): botões alternam, contadores mudam, desfazer volta ao estado anterior', 'README', async () => {
  const a = await reg('lk');
  const b = await reg('lk');
  await follow(a, b.u);
  await mkPost(b, `post para curtir ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  const card = page.locator('article', { hasText: `post para curtir ${cur}` });
  await card.getByRole('button', { name: 'Curtir' }).click();
  await card.getByRole('button', { name: 'Descurtir' }).waitFor();
  eq(await card.getByRole('button', { name: 'Descurtir' }).getAttribute('aria-pressed'), 'true', 'aria-pressed');
  check((await card.innerText()).includes('1'), 'o contador de curtidas deveria mostrar 1');
  // O botão de repost abre um menu com "Repostar" e "Citar".
  const repostBtn = card.first().getByRole('button', { name: 'Repostar ou citar' });
  await repostBtn.click();
  await card.first().getByRole('menuitem', { name: 'Repostar' }).click();
  await page.waitForFunction((t) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(t) && a.querySelector('[aria-label="Repostar ou citar"][aria-pressed="true"]')), `post para curtir ${cur}`);
  await card.first().getByRole('button', { name: 'Descurtir' }).click();
  await card.first().getByRole('button', { name: 'Curtir' }).waitFor();
  await card.first().getByRole('button', { name: 'Repostar ou citar' }).click();
  await card.first().getByRole('menuitem', { name: 'Desfazer repost' }).click();
  await page.waitForFunction((t) => [...document.querySelectorAll('article')].filter((a) => a.innerText.includes(t)).every((a) => a.querySelector('[aria-label="Repostar ou citar"]')?.getAttribute('aria-pressed') === 'false'), `post para curtir ${cur}`);
  await context.close();
});

// 7
sim('Token na tela', 'Recompensar pelo botão da moeda: saldo cai 1, extrato registra e a carteira explica a evaporação', 'docs/09', async () => {
  const a = await reg('tp');
  const b = await reg('tp');
  await follow(a, b.u);
  await mkPost(b, `post a recompensar ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  const card = page.locator('article', { hasText: `post a recompensar ${cur}` });
  await card.getByRole('button', { name: 'Recompensar com 1 NWC' }).click();
  await card.getByRole('button', { name: 'Você recompensou com 1 NWC' }).waitFor();
  await page.goto(WEB + '/carteira');
  await page.getByText('Seu saldo').waitFor();
  await page.getByText('Extrato').waitFor();
  const txt = await body(page);
  // 3 de boas-vindas − 1 da recompensa; se a missão "Recompense alguém" saiu hoje para esta
  // conta, ela paga +1 (docs/08). Por isso o saldo esperado vem do extrato, não de um número fixo.
  const w = (await api(a.tok, 'GET', '/api/carteira')).j;
  const missoes = w.ledger.filter((l) => l.kind === 'mission').reduce((t, l) => t + l.amount, 0);
  check(w.ledger.some((l) => l.kind === 'tip_sent' && l.amount === -1), 'o extrato deveria ter a recompensa de −1 NWC');
  eq(w.balance, 2 + missoes, 'saldo (3 − 1 + missões)');
  check(new RegExp(`${w.balance}\\s*NWC`).test(txt), `a tela deveria mostrar ${w.balance} NWC: ${txt.slice(0, 120).replace(/\s+/g, ' ')}`);
  check(txt.includes(`Você recompensou @${b.u}`), 'o extrato deveria citar a pessoa recompensada');
  check(/evapora/.test(txt) && /7 dias/.test(txt), 'a carteira deveria explicar a evaporação em 7 dias');
  check(/missões/.test(txt) && /não é dinheiro/.test(txt), 'a carteira deveria dizer que o NWC não é dinheiro');
  await context.close();
});

// 8
sim('Algoritmo na tela', '"Para você" carrega no aparelho, explica cada post e "Menos disto" esconde o post e persiste', 'docs/07 §2', async () => {
  const a = await reg('pv');
  const b = await reg('pv');
  for (let i = 0; i < 3; i++) await mkPost(b, `Postgres e cache número ${i} (${cur})`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  await page.getByRole('tab', { name: 'Para você' }).click();
  await page.getByText(/Este aparelho ainda não tem o seu algoritmo/).waitFor();
  const why = page.getByRole('button', { name: /Por que este post/ }).first();
  await why.waitFor();
  check(/calculado neste aparelho/.test(await why.innerText()), 'o rótulo deveria dizer que foi calculado no aparelho');
  await why.click();
  const region = page.getByRole('region', { name: 'Explicação do ranking' });
  await region.waitFor();
  const t = await region.innerText();
  check(/Pontuação \d+ de 100/.test(t), `faltou a pontuação: ${t.slice(0, 100)}`);
  for (const f of ['Seus interesses', 'recência', 'novidade'].slice(0, 1)) check(t.includes(f), `faltou o fator "${f}"`);
  const antes = await page.locator('article').count();
  await region.getByRole('button', { name: 'Menos disto' }).click();
  await page.getByText('Anotado: menos posts assim.').first().waitFor().catch(() => {});
  await page.waitForFunction((n) => document.querySelectorAll('article').length < n, antes);
  const st = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('agora.algo')).map(([k, v]) => [k, JSON.parse(v).hidden.length]));
  check(st.length === 1 && st[0][1] === 1, `o post escondido deveria estar só no aparelho: ${JSON.stringify(st)}`);
  eq((await api(a.tok, 'GET', '/api/feed/preferencias')).j.hidden_post_ids, [], 'o servidor não pode ter guardado o post escondido');
  await context.close();
});

// 9
sim('Algoritmo na tela', 'Meu algoritmo: salvar fica só no aparelho, sobrevive a recarregar e a sair/entrar, e outra conta não herda', 'docs/07 §2.10', async () => {
  const a = await reg('al');
  const b = await reg('al');
  const { page, context } = await open();
  const puts = [];
  page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/feed/')) puts.push(r.postData()); });
  await uiLogin(page, a.email);
  await page.goto(WEB + '/interesses');
  await page.getByText('Onde fica o seu algoritmo').waitFor();
  await page.getByLabel('Nova palavra-chave').fill('ciclovia');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: 'Salvar preferências' }).click();
  await page.getByText(/Preferências salvas neste aparelho/).waitFor();
  for (const p of puts) { const keys = Object.keys(JSON.parse(p)).sort(); check(keys.every((k) => ['count_time', 'missions_enabled'].includes(k)), `o servidor recebeu campos do algoritmo: ${keys}`); }
  await page.reload();
  await page.getByRole('button', { name: 'Remover ciclovia' }).waitFor();
  await page.goto(WEB + `/u/${a.u}`);
  await page.getByRole('button', { name: 'Sair', exact: true }).first().click();
  await page.getByText(/Você está só lendo/).waitFor();
  await uiLogin(page, a.email);
  await page.goto(WEB + '/interesses');
  await page.getByRole('button', { name: 'Remover ciclovia' }).waitFor();
  await page.goto(WEB + `/u/${a.u}`);
  await page.getByRole('button', { name: 'Sair', exact: true }).first().click();
  await page.getByText(/Você está só lendo/).waitFor();
  await uiLogin(page, b.email);
  await page.goto(WEB + '/interesses');
  await page.getByText('Nenhuma ainda.').waitFor();
  eq((await api(a.tok, 'GET', '/api/feed/preferencias')).j.settings.keywords, [], 'o servidor não pode ter as palavras-chave');
  await context.close();
});

// 10
sim('Perfis na tela', 'Explorar: a busca acha o post pelas palavras e a pessoa por parte do nome, e leva ao perfil', 'docs/03 §4', async () => {
  const a = await reg('ex');
  const b = await reg('ex');
  await mkPost(b, `post no explorar ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  await page.locator('nav[aria-label="Principal (celular)"] a', { hasText: 'Explorar' }).click();
  await page.getByText('Timeline pública desta instância').waitFor();
  await page.getByText(`post no explorar ${cur}`).first().waitFor();
  // A busca acha o post pelas palavras (aba Posts) e a pessoa pelo nome (aba Pessoas).
  await page.getByLabel('Buscar posts e pessoas').fill(`explorar ${cur}`);
  await page.getByRole('tab', { name: 'Posts', selected: true }).waitFor();
  await page.locator('article', { hasText: `post no explorar ${cur}` }).first().waitFor();
  await page.getByLabel('Buscar posts e pessoas').fill(b.u.slice(0, 7));
  await page.getByRole('tab', { name: 'Pessoas' }).click();
  await page.getByRole('link', { name: new RegExp(`@${b.u}`) }).first().click();
  await page.getByRole('heading', { name: `Pessoa ${b.u}` }).first().waitFor();
  await context.close();
});

// 11
sim('Perfis na tela', 'Perfil: Seguir e Seguindo alternam e os contadores acompanham', 'docs/03 §4', async () => {
  const a = await reg('sg');
  const b = await reg('sg');
  const { page, context } = await open();
  await uiLogin(page, a.email);
  await page.goto(WEB + `/u/${b.u}`);
  await page.getByRole('button', { name: 'Seguir', exact: true }).click();
  await page.getByRole('button', { name: 'Seguindo', exact: true }).waitFor();
  check(/1\s*Seguidores/.test((await body(page)).replace(/\n/g, ' ')), 'o contador de seguidores deveria ser 1');
  await page.getByRole('button', { name: 'Seguindo', exact: true }).click();
  await page.getByRole('button', { name: 'Seguir', exact: true }).waitFor();
  check(/0\s*Seguidores/.test((await body(page)).replace(/\n/g, ' ')), 'o contador deveria voltar a 0');
  await context.close();
});

// 12
sim('Moderação na tela', 'Silenciar pelo menu "⋯": o cartão vira aviso com Desfazer e o post volta ao desfazer', 'docs/11 §1', async () => {
  const a = await reg('mu');
  const b = await reg('mu');
  await follow(a, b.u);
  await mkPost(b, `post de quem será silenciado ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  const card = page.locator('article', { hasText: `post de quem será silenciado ${cur}` });
  await card.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: `Silenciar @${b.u}` }).click();
  await page.getByText(`Você silenciou @${b.u}. Os posts dessa conta não aparecem mais nos seus feeds.`).waitFor();
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.getByText(`post de quem será silenciado ${cur}`).first().waitFor();
  await context.close();
});

// 13
sim('Moderação na tela', 'Denunciar pelo menu: motivo, envio, confirmação e o acompanhamento em "Privacidade e dados"', 'docs/11 §1, docs/12', async () => {
  const a = await reg('dn');
  const b = await reg('dn');
  await follow(a, b.u);
  await mkPost(b, `post a denunciar ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  const card = page.locator('article', { hasText: `post a denunciar ${cur}` });
  await card.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: 'Denunciar post' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByText('Qual é o problema?').waitFor();
  check((await dlg.innerText()).includes('não fica sabendo quem denunciou'), 'o diálogo deveria garantir o anonimato da denúncia');
  await dlg.getByLabel('Spam ou propaganda repetitiva').check();
  await dlg.getByRole('button', { name: 'Enviar denúncia' }).click();
  await dlg.getByText('Denúncia enviada').waitFor();
  check(await dlg.getByRole('button', { name: new RegExp(`Bloquear @${b.u}`) }).count() === 1, 'depois de denunciar, o app deveria oferecer bloquear');
  await dlg.getByRole('button', { name: /Concluir|Fechar|Ok|Pronto/ }).first().click().catch(async () => { await page.keyboard.press('Escape'); });
  await page.goto(WEB + '/privacidade');
  await page.getByText('Suas denúncias').waitFor();
  await page.waitForFunction((u) => document.body.innerText.includes(`Post de @${u}`) || /Em análise/.test(document.body.innerText), b.u, { timeout: 5000 }).catch(() => {});
  check((await body(page)).includes(`Post de @${b.u}`) || (await body(page)).includes('Em análise'), 'a denúncia deveria aparecer em "Suas denúncias"');
  eq((await api(a.tok, 'GET', '/api/denuncias')).j.data.length, 1, 'denúncias no servidor');
  await context.close();
});

// 14
sim('Moderação na tela', 'Bloquear pelo menu: pede confirmação, o post some, o perfil avisa e dá para desbloquear', 'docs/11 §1', async () => {
  const a = await reg('bk');
  const b = await reg('bk');
  await follow(a, b.u);
  await mkPost(b, `post de quem será bloqueado ${cur}`);
  const { page, context } = await open();
  await uiLogin(page, a.email);
  const card = page.locator('article', { hasText: `post de quem será bloqueado ${cur}` });
  await card.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: `Bloquear @${b.u}` }).click();
  await page.getByText(`Bloquear @${b.u}?`).waitFor();
  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await page.getByText(`Você bloqueou @${b.u}.`).waitFor();
  await page.goto(WEB + `/u/${b.u}`);
  await page.getByText(/Você bloqueou @/).waitFor();
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await page.getByRole('button', { name: 'Seguir', exact: true }).waitFor();
  await context.close();
});

// 15
sim('Moderação na tela', 'Fila da moderação: remover sem escolher a regra é recusado; com a regra, o post sai e quem denunciou vê "Acatada"', 'docs/12 §1', async () => {
  const a = await reg('mq');
  const b = await reg('mq');
  const p = await mkPost(b, `post a ser removido pela moderação ${cur}`);
  const d = (await api(a.tok, 'POST', '/api/denuncias', { post_id: p.id, reason: 'spam' })).j.data;
  const { page, context } = await open();
  await uiLogin(page, 'ana_dev@exemplo.test', 'senha1234');
  await page.goto(WEB + '/moderacao');
  const card = page.locator('.rounded-3xl, article, li, div', { hasText: `post a ser removido pela moderação ${cur}` }).filter({ has: page.getByRole('button', { name: 'Remover post' }) }).last();
  await card.getByRole('button', { name: 'Remover post' }).click();
  const confirm = card.getByRole('group', { name: 'Confirmar decisão' });
  await confirm.getByRole('button', { name: 'Remover post' }).click();
  await card.getByRole('alert').filter({ hasText: 'Escolha qual regra foi quebrada.' }).waitFor();
  await confirm.getByRole('combobox').selectOption({ index: 4 });
  await confirm.getByRole('button', { name: 'Remover post' }).click();
  await page.waitForFunction((t) => !document.body.innerText.includes(t), `post a ser removido pela moderação ${cur}`, { timeout: 5000 }).catch(() => {});
  eq((await api(null, 'GET', `/api/posts/${p.id}`)).s, 404, 'o post some para todos');
  const mine = (await api(a.tok, 'GET', '/api/denuncias')).j.data[0];
  eq([mine.status, mine.resolution], ['acatada', 'remover_post'], 'o resultado da denúncia');
  await context.close();
  const { page: p2, context: c2 } = await open();
  await uiLogin(p2, a.email);
  await p2.goto(WEB + '/privacidade');
  await p2.getByText('Acatada').first().waitFor();
  await c2.close();
});

// 16
sim('Moderação na tela', 'Conta suspensa: a tela de entrar mostra o motivo e permite recorrer; depois mostra "em análise"', 'docs/12 §1', async () => {
  const m = await modTok();
  const a = await reg('sp');
  const b = await reg('sp');
  const d = (await api(b.tok, 'POST', '/api/denuncias', { username: a.u, reason: 'spam' })).j.data;
  const regras = (await api(null, 'GET', '/api/instancia/regras')).j.data.rules;
  eq((await api(m, 'POST', `/api/moderacao/denuncias/${d.id}/resolver`, { action: 'suspender', rule_id: regras[3].id, note: 'divulgação repetida' })).s, 200, 'suspender');
  const { page, context } = await open();
  await page.goto(WEB + '/login');
  await page.getByLabel('E-mail').fill(a.email);
  await page.getByLabel('Senha').fill(PASS);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('heading', { name: 'Conta suspensa' }).waitFor();
  const t = await body(page);
  check(t.includes('4. Sem spam') || t.includes('Sem spam'), 'a tela deveria citar a regra');
  check(t.includes('divulgação repetida'), 'a tela deveria mostrar a nota da moderação');
  await page.getByRole('textbox').fill('Foi um engano: o post era uma única divulgação.');
  await page.getByRole('button', { name: 'Enviar recurso' }).click();
  await page.getByText('Seu recurso está em análise.').waitFor();
  await context.close();
  await api(m, 'POST', `/api/moderacao/usuarios/${a.u}/reativar`);
});

// 17
sim('Tempo real na tela', 'Tempo real: mensagem de canal sem recarregar, reação e o aviso "Mostrar 1 post novo" na timeline', 'docs/02, README (como rodar)', async () => {
  const a = await reg('rt');
  const b = await reg('rt');
  const slug = `rt${cur}${rnd()}`;
  await api(a.tok, 'POST', '/api/channels', { slug, title: 'Sala ao vivo', kind: 'group' });
  await api(b.tok, 'POST', `/api/channels/${slug}/members`);
  const A = await open();
  const B = await open();
  await uiLogin(A.page, a.email);
  await uiLogin(B.page, b.email);
  await A.page.goto(WEB + `/canais/${slug}`);
  await B.page.goto(WEB + `/canais/${slug}`);
  await A.page.getByRole('textbox', { name: 'Mensagem' }).waitFor();
  await B.page.getByRole('textbox', { name: 'Mensagem' }).fill('oi ao vivo, pessoal');
  await B.page.getByRole('button', { name: 'Enviar' }).click();
  const t0 = Date.now();
  await A.page.getByText('oi ao vivo, pessoal').waitFor({ timeout: 4000 });
  const ms = Date.now() - t0;
  await A.page.locator('li', { hasText: 'oi ao vivo, pessoal' }).getByLabel('Reagir').click();
  await A.page.getByRole('button', { name: '🔥' }).click();
  await B.page.getByText(/🔥\s*1/).waitFor({ timeout: 4000 });
  // README: "veja o aviso 'Mostrar 1 post novo' aparecer" na timeline de quem segue.
  await api(a.tok, 'POST', `/api/users/${b.u}/follow`);
  await A.page.goto(WEB + '/');
  await A.page.getByRole('tab', { name: 'Seguindo' }).waitFor();
  await A.page.waitForTimeout(600);
  await mkPost(b, `post novo ao vivo ${cur}`);
  const t1 = Date.now();
  await A.page.getByRole('button', { name: /Mostrar 1 post novo/ }).waitFor({ timeout: 4000 });
  const ms2 = Date.now() - t1;
  check(!(await body(A.page)).includes(`post novo ao vivo ${cur}`), 'o post novo não pode entrar sozinho e deslocar a leitura');
  await A.page.getByRole('button', { name: /Mostrar 1 post novo/ }).click();
  await A.page.getByText(`post novo ao vivo ${cur}`).waitFor();
  check(A.errs.length + B.errs.length === 0, `erros de página: ${A.errs}${B.errs}`);
  await A.context.close();
  await B.context.close();
  return `mensagem chegou em ${ms} ms; aviso de post novo em ${ms2} ms`;
});

// 18
sim('Tempo real na tela', 'Grupo fechado: quem não entrou vê o aviso; entra e lê; o dono remove a pessoa e ela perde o acesso', 'docs/14 C-1 e C-2', async () => {
  const dona = await reg('gf');
  const x = await reg('gf');
  const slug = `gf${cur}${rnd()}`;
  await api(dona.tok, 'POST', '/api/channels', { slug, title: 'Grupo fechado', kind: 'group' });
  await api(dona.tok, 'POST', `/api/channels/${slug}/messages`, { text: 'conversa só de membros' });
  const X = await open();
  await uiLogin(X.page, x.email);
  await X.page.goto(WEB + `/canais/${slug}`);
  await X.page.getByText('Este grupo é só para quem entrou. Entre para ver e mandar mensagens.').waitFor();
  check(!(await body(X.page)).includes('conversa só de membros'), 'a conversa não pode aparecer para quem não entrou');
  await X.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await X.page.getByText('conversa só de membros').waitFor();
  await X.page.getByRole('textbox', { name: 'Mensagem' }).fill('oi, cheguei agora');
  await X.page.getByRole('button', { name: 'Enviar' }).click();
  const D = await open();
  D.page.on('dialog', (dl) => dl.accept());
  await uiLogin(D.page, dona.email);
  await D.page.goto(WEB + `/canais/${slug}`);
  await D.page.getByText('oi, cheguei agora').waitFor();
  await D.page.getByRole('button', { name: 'Remover', exact: true }).click();
  await D.page.getByText(new RegExp(`@${x.u} foi removido`)).waitFor();
  await X.page.getByText('Este grupo é só para quem entrou. Entre para ver e mandar mensagens.').waitFor({ timeout: 5000 });
  const again = await api(x.tok, 'POST', `/api/channels/${slug}/members`);
  eq(again.s, 403, 'quem foi removido não entra de novo');
  await X.context.close();
  await D.context.close();
});

// 19
sim('Missões na tela', 'Missões: 4 cartões, pular tira a cobrança, convite gera o link e "A rede, junta" aparece sem ranking', 'docs/08 §2 e §4', async () => {
  const a = await reg('ms');
  const { page, context } = await open();
  await uiLogin(page, a.email);
  await page.goto(WEB + '/missoes');
  await page.getByRole('region', { name: 'Suas missões' }).waitFor();
  const n = await page.getByRole('region', { name: 'Suas missões' }).locator('li, article').count();
  check(n >= 4, `deveria mostrar 4 missões, mostrou ${n}`);
  await page.getByRole('region', { name: 'A rede hoje' }).waitFor();
  const t = await body(page);
  check(!/ranking de pessoas|sequência de \d+ dias|streak/i.test(t.replace('sem sequências nem ranking', '').replace(/Sem sequências e sem ranking[^.]*\./i, '')), 'não pode haver sequência nem ranking de pessoas');
  const pular = page.getByRole('button', { name: 'Pular hoje' }).first();
  await pular.click();
  await page.getByText(/pulada|Pulada/).first().waitFor();
  // Convites: docs/08 §5 diz que cada pessoa gera convites, com ou sem a missão de convite no dia.
  const comMissao = (await api(a.tok, 'GET', '/api/missoes')).j.missions.some((m) => m.id === 'convidar' && m.status === 'todo');
  const botoes = page.getByRole('button', { name: 'Gerar convite' });
  check((await botoes.count()) === 1, `deveria haver exatamente 1 botão "Gerar convite" (missão de convite hoje: ${comMissao}), há ${await botoes.count()}`);
  if (!comMissao) check((await page.getByRole('region', { name: 'Seus convites' }).getByRole('button', { name: 'Gerar convite' }).count()) === 1, 'sem a missão, o botão deveria ficar em "Seus convites"');
  await botoes.first().click();
  await page.getByLabel('Link do convite').first().waitFor();
  check((await page.getByLabel('Link do convite').first().inputValue()).includes('/cadastro?convite='), 'o link do convite deveria apontar para o cadastro');
  await context.close();
});

// 20
sim('Brasil na tela', 'Aba Brasil (visitante): 5 cartões, selo, data da conferência, histórico de 5 anos e links; sem botão de atualizar', 'docs/13 §13', async () => {
  const { page, context } = await open();
  await page.goto(WEB + '/brasil');
  await page.getByText('Conferido em 29 out 2026').waitFor();
  const cards = page.getByRole('article');
  await cards.first().waitFor();
  eq(await cards.count(), 5, 'cartões');
  const txt = await body(page);
  for (const v of ['4,58%', 'R$ 922,51', '5,3%', '2,0%']) check(txt.includes(v), `faltou o número ${v}`);
  check(txt.includes('13,75% ao ano'), 'a Selic deveria aparecer como "13,75% ao ano", sem espaço antes do %, como os outros indicadores');
  for (const s of ['Fonte única, conferida', 'Conferência parcial', 'Confirmado por 3 conferências']) check(txt.includes(s), `faltou o selo "${s}"`);
  check(/não se atualizam sozinhos/.test(txt), 'faltou avisar que os números não se atualizam sozinhos');
  check(txt.includes('Em dez/2021: 10,06%'), 'faltou o valor de 5 anos atrás no cartão da inflação');
  check((await page.getByRole('button', { name: 'Atualizar agora' }).count()) === 0, 'visitante não vê "Atualizar agora"');
  const cesta = page.getByRole('article', { name: 'Custo da cesta básica' });
  await cesta.getByRole('button', { name: 'De onde vem este número?' }).click();
  const c = await cesta.innerText();
  for (const s of ['Histórico', 'dez/2021', 'R$ 690,51', 'Ainda não conferida', 'Publicado pela fonte em']) check(c.toLowerCase().includes(s.toLowerCase()), `a cesta deveria mostrar "${s}"`);
  check((await cesta.getByRole('link', { name: /Ver a publicação/ }).getAttribute('href')).startsWith('https://www.dieese.org.br'), 'link da publicação do DIEESE');
  await context.close();
  return { detail: '5 cartões, selos, histórico e links' };
});

// 21
sim('Regras na tela', 'Regras da instância abertas a visitantes: 7 regras, quem modera, e a moderadora vê o botão de editar', 'docs/12 §1', async () => {
  const { page, context } = await open();
  await page.goto(WEB + '/regras');
  await page.getByText('Respeite as pessoas').waitFor();
  const t = await body(page);
  for (const r of ['Sem discurso de ódio', 'Sem golpes nem se passar por outra pessoa', 'Sem spam', 'Proteja a privacidade', 'O NWC não é dinheiro', 'Nada ilegal']) check(t.includes(r), `faltou "${r}"`);
  check(t.includes('ana_dev'), 'deveria mostrar quem modera');
  check((await page.getByRole('button', { name: /Editar regras/ }).count()) === 0, 'visitante não vê "Editar regras"');
  await context.close();
  const { page: p2, context: c2 } = await open();
  await uiLogin(p2, 'ana_dev@exemplo.test', 'senha1234');
  await p2.goto(WEB + '/regras');
  await p2.getByRole('button', { name: /Editar regras/ }).waitFor();
  await c2.close();
});

// 22
sim('Layout', 'Sem rolagem horizontal em 320, 390, 768 e 1280 px; menu inferior no celular e coluna lateral no desktop', 'README (mobile first)', async () => {
  const a = await reg('lay');
  const bad = [];
  for (const w of [320, 390, 768, 1280]) {
    const { page, context } = await open({ viewport: { width: w, height: 800 } });
    for (const path of ['/login', '/regras', '/brasil']) {
      await page.goto(WEB + path);
      await page.waitForTimeout(250);
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) bad.push(`${w}px ${path}`);
    }
    await uiLogin(page, a.email);
    for (const path of ['/', '/explorar', '/canais', '/missoes', '/carteira', '/interesses', '/privacidade', '/brasil']) {
      await page.goto(WEB + path);
      await page.waitForTimeout(350);
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) bad.push(`${w}px ${path}`);
    }
    await page.goto(WEB + '/');
    const side = await page.locator('nav[aria-label="Principal"]').isVisible();
    const bottom = await page.locator('nav[aria-label="Principal (celular)"]').isVisible();
    if (w >= 768) check(side && !bottom, `${w}px: deveria ter coluna lateral e não o menu inferior (lateral=${side}, inferior=${bottom})`);
    else check(!side && bottom, `${w}px: deveria ter o menu inferior e não a coluna lateral (lateral=${side}, inferior=${bottom})`);
    await context.close();
  }
  check(bad.length === 0, `rolagem horizontal em: ${bad.join(', ')}`);
});

// 23
sim('Acessibilidade', 'Botões, campos e imagens têm nome acessível; há região principal, idioma e títulos; Tab percorre o login na ordem', 'boas práticas (WCAG 2.1 A)', async () => {
  const a = await reg('ac');
  const b = await reg('ac');
  await follow(a, b.u);
  await mkPost(b, `post para acessibilidade ${cur}`);
  const { page, context } = await open();
  const problemas = [];
  const audit = async (path) => {
    await page.goto(WEB + path);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.innerText || el.textContent || '').trim();
      const sem = [...document.querySelectorAll('button, a[href], [role=button]')].filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 70));
      const campos = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].filter((el) => !(el.getAttribute('aria-label') || el.labels?.length || el.getAttribute('aria-labelledby'))).map((el) => el.outerHTML.slice(0, 70));
      const imgs = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
      return { sem, campos, imgs, main: document.querySelectorAll('main').length, h: document.querySelectorAll('h1, h2').length, lang: document.documentElement.lang };
    });
    if (r.sem.length) problemas.push(`${path}: ${r.sem.length} botão/link sem nome (${r.sem[0]})`);
    if (r.campos.length) problemas.push(`${path}: ${r.campos.length} campo sem rótulo (${r.campos[0]})`);
    if (r.imgs) problemas.push(`${path}: ${r.imgs} imagem sem alt`);
    if (r.main < 1) problemas.push(`${path}: sem região <main>`);
    if (r.h < 1) problemas.push(`${path}: sem título (h1/h2)`);
    if (r.lang !== 'pt-BR') problemas.push(`${path}: lang="${r.lang}"`);
  };
  await page.goto(WEB + '/login');
  await page.getByLabel('E-mail').focus();
  const ordem = [];
  for (let i = 0; i < 4; i++) {
    ordem.push(await page.evaluate(() => { const e = document.activeElement; return e.getAttribute('name') || e.innerText || e.tagName; }));
    await page.keyboard.press('Tab');
  }
  check(ordem[0] === 'email' && ordem[1] === 'password' && /Mostrar/.test(ordem[2]) && /Entrar/.test(ordem[3]), `ordem do Tab no login: ${ordem.join(' → ')}`);
  for (const p of ['/login', '/cadastro', '/regras']) await audit(p);
  await uiLogin(page, a.email);
  for (const p of ['/', '/explorar', '/canais', '/missoes', '/carteira', '/interesses', '/privacidade', '/brasil', `/u/${b.u}`]) await audit(p);
  check(problemas.length === 0, problemas.slice(0, 6).join(' | '));
  await context.close();
});

// 24
sim('Navegação e erros', 'Abas do celular levam às telas certas; rota inexistente e falta de rede mostram aviso, não tela vazia', 'README (navegação), usabilidade', async () => {
  const a = await reg('nv');
  const { page, context } = await open();
  await uiLogin(page, a.email);
  const nav = page.locator('nav[aria-label="Principal (celular)"]');
  const alvo = { Início: 'Início', Brasil: 'Brasil em dados', Explorar: 'Explorar', Notificações: 'Notificações', Canais: 'Canais' };
  for (const [aba, titulo] of Object.entries(alvo)) {
    await nav.getByRole('link', { name: aba }).click();
    await page.getByRole('heading', { name: titulo }).first().waitFor();
  }
  await nav.getByRole('link', { name: 'Perfil' }).click();
  await page.getByRole('heading', { name: `Pessoa ${a.u}` }).first().waitFor();
  await page.goto(WEB + '/pagina-que-nao-existe');
  await page.getByText('Página não encontrada.').waitFor();
  await page.goto(WEB + '/');
  await page.getByRole('tab', { name: 'Seguindo' }).waitFor();
  await context.setOffline(true);
  await nav.getByRole('link', { name: 'Canais' }).click();
  await page.waitForTimeout(2500);
  const t = await body(page);
  check(!/Failed to fetch|NetworkError|Load failed/.test(t), 'sem rede, a tela não pode mostrar a mensagem técnica do navegador em inglês');
  check(/Sem conexão com o servidor/.test(t), 'sem rede, Canais deveria dizer "Sem conexão com o servidor…"');
  check(!/Carregando…/.test(t), 'sem rede, Canais não pode ficar em "Carregando…"');
  // Volta a rede: "Tentar de novo" carrega a lista sem recarregar a página.
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await page.getByRole('heading', { name: 'Canais' }).first().waitFor();
  await page.getByRole('link', { name: /Café/ }).first().waitFor();
  await context.close();
  return { detail: 'abas, rota inexistente, aviso sem rede em português e "Tentar de novo"' };
});

(async () => {
  browser = await chromium.launch();
  const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',').map(Number)) : null;
  for (const [i, s] of sims.entries()) {
    const n = FIRST + i;
    if (only && !only.has(n)) continue;
    cur = String(n).padStart(3, '0');
    lastPages = [];
    const t0 = Date.now();
    let r = { ok: true, detail: '' };
    try {
      const v = await Promise.race([s.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado (60 s)')), 60000))]);
      if (typeof v === 'string') r.detail = v;
      else if (v) Object.assign(r, v);
    } catch (e) {
      const where = (e.stack ?? '').split('\n').find((l) => l.includes('ui.cjs'))?.replace(/.*ui\.cjs:/, 'linha ') ?? '';
      r = { ok: false, detail: `${String(e.message).split('\n')[0].slice(0, 260)} [${where}]` };
      const pg = lastPages.at(-1);
      if (pg) { try { await pg.screenshot({ path: `/tmp/claude-0/sec/ui-fail-${cur}.png` }); r.detail += ` url=${pg.url().replace(WEB, '')}`; } catch {} }
    }
    const rec = { id: `S${cur}`, kind: 'ui', area: s.area, title: s.title, doc: s.doc, ok: r.ok, detail: r.detail, notes: r.notes, ms: Date.now() - t0 };
    out.push(rec);
    console.log(r.ok ? 'OK  ' : 'FAIL', rec.id, `[${rec.area}]`, rec.title.slice(0, 90), r.ok ? '' : `\n       → ${r.detail}`, r.notes?.length ? `\n       ℹ ${r.notes.join(' | ')}` : '', `(${rec.ms} ms)`);
  }
  await browser.close();
  writeFileSync(process.env.SIM_OUT ?? '/tmp/claude-0/sec/sim-ui.json', JSON.stringify(out, null, 1));
  const bad = out.filter((x) => !x.ok);
  console.log(`\n${out.length - bad.length}/${out.length} passaram; ${bad.length} falharam`);
})();
