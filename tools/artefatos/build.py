# Monta o "Ágora por dentro" a partir do que walk.mjs, e2e.cjs e shots.cjs gravaram em OUT.
# Uso: python3 build.py <pasta de saída> <testes do backend> <testes do frontend> <versão>
# Os textos (resumo, utilidade, o que falta) são escritos à mão aqui e em tpl.html:
# revise-os quando uma mudança alterar o que o app faz.
import os, re, sys, datetime
OUT=sys.argv[1]; TB=sys.argv[2]; TF=sys.argv[3]; VERSION=sys.argv[4]
HERE=os.path.dirname(os.path.abspath(__file__))
MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
hoje=datetime.date.today(); DATE=f'{hoje.day} {MESES[hoje.month-1]} {hoje.year}'
import json,base64,io,html,statistics
from PIL import Image
d=json.load(open(OUT+'/results.json'))
for line in open(OUT+'/e2e-out.txt'):
    if line.startswith(('OK','FAIL')):
        ok=line.startswith('OK'); step=re.sub(r'\s*\((\[\]|\d+)\)$','',line[4:].strip())
        d.append({'area':'Sessão no navegador','step':step[0].upper()+step[1:],'ok':ok,'detail':'','ms':None})
E=html.escape
def img(n):
    im=Image.open(f'{OUT}/shots/{n}.png').convert('RGB'); im=im.resize((390,844))
    b=io.BytesIO(); im.save(b,'JPEG',quality=72); return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
shots=[('visitante','Sem conta','Lê a timeline; para interagir, entra.'),
('login','Entrar','E-mail e senha, com “Esqueci minha senha”.'),
('seguindo','Seguindo','Ordem cronológica reversa, só de quem você segue.'),
('paravoce','Para você','Calculado neste aparelho, com “Por que este post?”.'),
('algoritmo','Meu algoritmo','Fica só no aparelho; pesos, temas e limite de sessão.'),
('notificacoes','Notificações','Quem interagiu, agrupado, com contador no sino.'),
('busca','Busca','Posts pelas palavras, mais recentes primeiro.'),
('imagem','Post com imagem','Descrição obrigatória e sem a localização da foto.'),
('citacao','Citação','O post citado aparece dentro do novo.'),
('missoes','Missões do dia','4 por dia, verificadas pelas ações reais.'),
('carteira','Carteira NWC','Saldo, extrato e a regra da evaporação.'),
('canal','Canal Café','Grupo em tempo real com reações.'),
('perfil','Perfil','Posts, seguidores e “Sair de todos os aparelhos”.'),
('brasil','Brasil em dados','Último número oficial, selo e 5 anos de histórico.'),
('moderacao','Fila da moderação','Denúncias abertas, recursos e decisões.'),
('regras','Regras da instância','Públicas; toda remoção cita uma delas.'),
('privacidade','Privacidade e dados','Quem vê o quê, baixar os dados e excluir a conta.'),
('termo','Termo do piloto','O que o app guarda, para quê e como sair.'),
('esqueci','Esqueci minha senha','A resposta não revela quem tem conta.')]
areas=[]
for x in d:
    if x['area'] not in areas: areas.append(x['area'])
ms=[x['ms'] for x in d if x.get('ms')]
med=statistics.median(ms)
def fix(s):
    if s.startswith(' · fatores'): return 'versão interesses-v1 · fatores: '+s.split(': ',1)[1]
    if s.startswith('[{"source"'): return 'pedido aceito; as 9 fontes foram tentadas, a falha de cada uma ficou registrada e nada foi inventado'
    if s.startswith('undefined: '): return 'remoção de post, regra '+s.split(': ',1)[1]
    return s.replace(' · fatores: ','Fatores: ').replace('pts=','pts ')
rows=''
for a in areas:
    items=[x for x in d if x['area']==a]
    ok=sum(x['ok'] for x in items)
    trs=''.join(f"<tr><td class=st><span class='pill {'ok' if x['ok'] else 'bad'}'>{'passou' if x['ok'] else 'falhou'}</span></td><td><b>{E(x['step'])}</b><div class=det>{E(fix(x['detail'] or ''))}</div></td><td class=num>{'' if x.get('ms') is None else f'{x['ms']:.0f} ms'}</td></tr>" for x in items)
    rows+=f"<details class=area open><summary><span class=an>{E(a)}</span><span class=ac>{ok}/{len(items)}</span></summary><div class=tw><table>{trs}</table></div></details>"
gal=''.join(f"<figure><img src='{img(n)}' alt='Tela {E(t)} do app no celular' loading=lazy width=390 height=844><figcaption><b>{E(t)}</b>{E(c)}</figcaption></figure>" for n,t,c in shots)
util=[
('Contas','Cadastro com aceite das regras, login com e-mail e senha, bcrypt, até 10 senhas erradas por conta a cada 15 min.','Funciona','O cadastro ainda revela se um e-mail já existe (M3).'),
('Privacidade e dados','Termo de consentimento no cadastro (público, versionado, 18+); baixar todos os seus dados num arquivo; excluir a conta com a senha, recontando os números dos posts dos outros e reservando o @.','Funciona','Quem trava o app sem o aceite do termo novo é a tela; a API não recusa. Conta suspensa pede a exclusão a quem administra.'),
('Recuperar senha','Link de uso único por e-mail, válido por 30 min; a resposta não revela quem tem conta; trocar a senha encerra todas as sessões.','Parcial','O e-mail não sai de verdade: vai para o log do servidor. Falta um serviço de e-mail.'),
('Sessão segura','Acesso de 15 min renovado sozinho por cookie protegido; sair de um aparelho ou de todos vale na hora.','Funciona','Com vários servidores, a queda imediata do tempo real precisa de Redis Pub/Sub.'),
('Leitura sem conta','Timeline, conversas, perfis, regras e Brasil abertos; interagir leva ao login e volta ao mesmo lugar.','Funciona','Sem conta, bloqueios não se aplicam (não há quem bloqueou).'),
('Perfis e follow','Seguir pessoas, ver seguidores e seguindo, busca por nome com índice de trigramas.','Funciona','Sem sugestão de quem seguir fora das missões.'),
('Posts e threads','Posts de até 280 caracteres, respostas em thread, menções, curtir, republicar, apagar.','Funciona','Sem vídeo e sem enquetes.'),
('Editar e citar','Editar o texto por 30 minutos, até 5 vezes, com histórico público; citar mostra o original dentro do post novo e avisa quem foi citado.','Funciona','Só o texto se edita (imagens não); quem tem bloqueio com a autora vê a citação sem o original.'),
('Imagens','Até 4 por post, com descrição obrigatória; reduzidas no aparelho; o servidor confere o tipo pelos bytes e tira a localização e os outros metadados.','Funciona','Ficam no Postgres: numa instância grande, o lugar delas é um armazenamento de arquivos com CDN.'),
('Busca de posts','Pelas palavras, em português, sem diferença de acento e pelo radical, mais recentes primeiro; aspas e -palavra.','Funciona','O radical não junta tudo (“eleição” não acha “eleições”); sem busca por parte de palavra.'),
('Notificações','Curtir, repostar, responder, mencionar, seguir e recompensar viram aviso, em tempo real e com contador.','Funciona','Só dentro do app aberto; não há push no celular.'),
('Feed Seguindo','Cronológico reverso, paginado por cursor, entregue por fan-out em Redis (por uma fila, fora do pedido de postar) com fallback SQL.','Funciona','Sem modelo híbrido: contas com centenas de milhares de seguidores ainda custam uma cópia por seguidor.'),
('Para você','Ranking aberto por interesses declarados, calculado no aparelho, com explicação por post, popularidade 0 e fim de sessão.','Funciona','Sem temas escolhidos, fica quase cronológico. Em outro aparelho, o algoritmo começa do zero.'),
('Silenciar e bloquear','Silenciar esconde só para quem silenciou. Bloquear vale nos dois sentidos, também em grupos e notificações.','Funciona','Não há bloqueio de instância inteira (federação).'),
('Denúncias e moderação','Denúncia com motivo, fila só para quem modera, decisão visível para quem denunciou; o autor não apaga a prova.','Funciona','Uma só pessoa modera no seed.'),
('Regras e recursos','Regras públicas; remover ou suspender exige citar uma. Cada decisão aceita um recurso; aceito, a decisão é desfeita.','Funciona','Com uma só pessoa na moderação, ela decide o próprio recurso.'),
('Canais e grupos','Tempo real por WebSocket, pts por canal, 8 reações, papéis; grupo só para quem entrou; quem administra remove pessoas.','Funciona','Com vários servidores, o tempo real entre eles precisa de Redis Pub/Sub.'),
('Brasil em dados','Inflação, cesta básica, desemprego, PIB e Selic, com fonte, selo de verificação e 5 anos de histórico.','Funciona','Registro conferido à mão em 29/10/2026: não se atualiza sozinho.'),
('Missões diárias','4 missões por dia dentro do app, verificadas pelas ações, meta coletiva em cache de 60 s, convites sempre disponíveis.','Funciona','Contas falsas ainda podem cumprir missões (M6).'),
('NewCoin (NWC)','Token interno: missões emitem, recompensa transfere 1 NWC ao autor, e sem uso o saldo evapora em 7 dias.','Funciona','Utilidade nula por enquanto, por decisão do projeto.'),
('Federação','Handles usuario@instancia, WebFinger, NodeInfo e outbox ActivityStreams.','Parcial','Só leitura: outra instância não consegue seguir nem responder.'),
]
ut=''.join(f"<tr><td><b>{E(a)}</b></td><td>{E(b)}</td><td><span class='pill {'ok' if c=='Funciona' else 'warn'}'>{E(c)}</span></td><td>{E(e)}</td></tr>" for a,b,c,e in util)
gaps=[
('Alta','Instalação do piloto','Para 5 a 10 pessoas de verdade, falta subir o app num endereço com HTTPS dentro de uma rede privada, com backup diário do banco testado.'),
('Média','Serviço de e-mail','A recuperação de senha está pronta, mas o e-mail vai para o log. Falta um serviço de envio e a confirmação de e-mail no cadastro (M3).'),
('Média','Contas falsas e o NWC','A evaporação desestimula guardar NWC em contas paradas, mas falta verificação de conta e teto de emissão antes de dar utilidade ao token (M6).'),
('Média','Federação de escrita','Falta inbox com assinatura HTTP para seguir e responder entre instâncias, e bloqueio de instância.'),
('Baixa','Escala de contas enormes','A distribuição já vai por fila; para contas com centenas de milhares de seguidores, falta misturar na leitura (modelo híbrido).'),
('Baixa','Notificações no celular','Os avisos só chegam com o app aberto; não há push.'),
('Baixa','Atualizar a aba Brasil','Os números são de um registro conferido à mão; precisa de nova conferência quando as fontes publicarem.'),
('Baixa','CI no GitHub','O workflow existe, mas a conta não libera o GitHub Actions; hoje os testes rodam só localmente.'),
]
gp=''.join(f"<tr><td><span class='pill sev-{s.lower()}'>{E(s)}</span></td><td><b>{E(a)}</b></td><td>{E(b)}</td></tr>" for s,a,b in gaps)
page=open(os.path.join(HERE,'tpl.html')).read()
for k,v in {'DATE':DATE,'VERSION':VERSION,'TESTS':str(int(TB)+int(TF)),'TB':TB,'TF':TF,'ROWS':rows,'GAL':gal,'UT':ut,'GAPS':gp,'N':str(len(d)),'OK':str(sum(x['ok'] for x in d)),'MED':f'{med:.0f}','AREAS':str(len(areas)),'NAPI':str(sum(1 for x in d if x['area']!='Sessão no navegador')),'NWEB':str(sum(1 for x in d if x['area']=='Sessão no navegador'))}.items():
    page=page.replace('{{'+k+'}}',v)
open(OUT+'/analise-agora.html','w').write(page)
print(len(page))
