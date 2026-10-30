# Prepara demo/index.html para publicar como artefato ("Ágora em ação").
# O publicador do claude.ai acrescenta o próprio esqueleto (doctype, head, body), então aqui sai só
# o conteúdo: <title>, a meta de margens laterais, os estilos e o corpo da página.
# Uso: python3 demo.py <pasta de saída>  → <pasta>/agora-demo.html
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(HERE, '..', '..', 'demo', 'index.html'), encoding='utf-8').read()
head = s[s.index('<title>'):s.index('</head>')]
body = s[s.index('>', s.index('<body')) + 1:s.index('</body>')]
head = head.replace('</title>\n', '</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n', 1)
out = os.path.join(sys.argv[1], 'agora-demo.html')
open(out, 'w', encoding='utf-8').write(head.rstrip('\n') + '\n' + body.lstrip('\n'))
print(out)
