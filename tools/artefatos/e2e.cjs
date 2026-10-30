const { chromium } = require('playwright');
// Sessão no navegador. Precisa de uma API com ACCESS_TOKEN_TTL_SEC=5 e um frontend apontando para ela (ver run.sh).
const U = process.env.WEB_SHORT ?? 'http://localhost:4175';
const API = process.env.API_SHORT ?? 'http://localhost:4030';
const log = (ok, msg) => console.log(ok ? 'OK  ' : 'FAIL', msg);
const MSG = 'oi do teste e2e ' + Date.now();
(async () => {
  const b = await chromium.launch();
  const ctxA = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctxA.newPage();
  const cspErrors = [];
  p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) cspErrors.push(m.text()); });
  let lastAuth = null;
  p.on('request', (r) => { const h = r.headers().authorization; if (h) lastAuth = h; });

  await p.goto(U + '/login');
  await p.getByLabel('E-mail').fill('ana_dev@exemplo.test');
  await p.getByLabel(/Senha/).fill('senha1234');
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.getByText('Seguindo', { exact: true }).first().waitFor();
  log(true, 'login pela tela');
  const ls = await p.evaluate(() => Object.keys(localStorage).filter((k) => /token/i.test(k)));
  log(ls.length === 0, `nenhum token no localStorage (${JSON.stringify(ls)})`);
  const cookies = await ctxA.cookies();
  const rc = cookies.find((c) => c.name === 'agora_refresh');
  log(rc && rc.httpOnly && rc.sameSite === 'Strict' && rc.path === '/api/auth', `cookie de sessão HttpOnly/Strict/path=${rc?.path}`);
  const jsSees = await p.evaluate(() => document.cookie);
  log(!jsSees.includes('agora_refresh'), 'o JavaScript da página não enxerga o cookie');

  await p.reload();
  await p.getByText('Seguindo', { exact: true }).first().waitFor({ timeout: 5000 });
  log(true, 'recarregar a página mantém a pessoa logada');

  // Token de acesso dura 5 s neste teste: espera vencer e usa o app.
  const tokenAntes = lastAuth;
  await p.waitForTimeout(6500);
  await p.goto(U + '/carteira');
  await p.getByText(/NWC/).first().waitFor({ timeout: 5000 });
  log(lastAuth !== tokenAntes, 'token vencido foi renovado sozinho, sem pedir senha');

  // Tempo real depois da renovação
  await p.goto(U + '/canais/cafe');
  await p.waitForTimeout(1500);
  const carla = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'carla_ux@exemplo.test', password: 'senha1234' }) })).json();
  const pm = await fetch(API + '/api/channels/cafe/messages', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + carla.token }, body: JSON.stringify({ text: MSG }) }); console.log('post msg', pm.status, carla.error ?? '');
  const chegou = await p.getByText(MSG).waitFor({ timeout: 5000 }).then(() => true, () => false);
  log(chegou, 'mensagem em tempo real chega no canal');

  // Sair: token antigo deixa de valer na hora
  const tokenAtual = lastAuth;
  await p.goto(U + '/u/ana_dev');
  await p.getByRole('button', { name: 'Sair' }).first().click();
  await p.getByText(/Você está só lendo/).waitFor();
  log(/Você saiu da sua conta/.test(await p.getByRole('status').first().innerText()), 'ao sair, a faixa confirma "Você saiu da sua conta."');
  const r = await fetch(API + '/api/auth/me', { headers: { authorization: tokenAtual } });
  log(r.status === 401, `depois de Sair, o token copiado recebe ${r.status}`);
  await p.reload();
  const voltou = await p.getByText(/Você está só lendo/).waitFor({ timeout: 4000 }).then(() => true, () => false);
  log(voltou, 'recarregar depois de Sair continua deslogado');

  // Sair de todos os aparelhos
  const ctxB = await b.newContext({ viewport: { width: 390, height: 844 } });
  const celular = await ctxB.newPage();
  for (const pg of [p, celular]) {
    await pg.goto(U + '/login');
    await pg.getByLabel('E-mail').fill('ana_dev@exemplo.test');
    await pg.getByLabel(/Senha/).fill('senha1234');
    await pg.getByRole('button', { name: 'Entrar', exact: true }).click();
    await pg.getByText('Seguindo', { exact: true }).first().waitFor();
  }
  await p.goto(U + '/u/ana_dev');
  await p.getByRole('button', { name: 'Sair de todos os aparelhos' }).click();
    await p.getByRole('button', { name: 'Sair de todos' }).click();
  await p.getByText(/Você está só lendo/).waitFor();
  await celular.reload();
  const celularSaiu = await celular.getByText(/Você está só lendo/).waitFor({ timeout: 5000 }).then(() => true, () => false);
  log(celularSaiu, 'o outro aparelho também foi desconectado');

  // Visitante: lê, mas curtir leva ao login e, depois de entrar, volta ao mesmo post.
  const ctxV = await b.newContext({ viewport: { width: 390, height: 844 } });
  const v = await ctxV.newPage();
  const alvo = (await (await fetch(API + '/api/posts?max_results=1')).json()).data[0].id;
  await v.goto(U + '/post/' + alvo);
  await v.getByText(/Você está só lendo/).waitFor();
  const first = v.locator('article').first();
  await first.waitFor();
  await first.getByRole('button', { name: /Curtir/ }).click();
  await v.getByRole('heading', { name: 'Entrar' }).waitFor();
  log(/Entre para interagir/.test(await v.locator('main').innerText()), 'visitante: curtir leva ao login com o aviso "Entre para interagir"');
  await v.getByLabel('E-mail').fill('bruno_pesquisa@exemplo.test');
  await v.getByLabel(/Senha/).fill('senha1234');
  await v.getByRole('button', { name: 'Entrar', exact: true }).click();
  await v.waitForTimeout(1500);
  log(new URL(v.url()).pathname === '/post/' + alvo, `depois de entrar, volta ao mesmo post (${new URL(v.url()).pathname})`);

  log(cspErrors.length === 0, `nenhum bloqueio da política de conteúdo (${cspErrors.length})`);
  await b.close();
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
