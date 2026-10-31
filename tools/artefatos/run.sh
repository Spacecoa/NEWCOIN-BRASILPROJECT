#!/usr/bin/env bash
# Gera os dois artefatos do projeto a partir do app rodando de verdade:
#   <saída>/analise-agora.html  → "Ágora por dentro"
#   <saída>/agora-demo.html     → "Ágora em ação" (demo/index.html pronto para publicar)
#
# Precisa de: Postgres e Redis no ar (docker compose up -d), npm install em backend/ e frontend/,
# Playwright com Chromium, redis-cli e Python 3 com Pillow.
# ATENÇÃO: roda o seed, que APAGA o banco de desenvolvimento (o banco de teste também é usado).
#
# Uso: tools/artefatos/run.sh [pasta de saída]   (padrão: /tmp/agora-artefatos)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$(mkdir -p "${1:-/tmp/agora-artefatos}" && cd "${1:-/tmp/agora-artefatos}" && pwd)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
wait_up() { for _ in $(seq 1 40); do curl -s -o /dev/null --max-time 1 "$1" && return 0; sleep 0.5; done; echo "não subiu: $1" >&2; exit 1; }
for port in 4000 4030 4173 4175; do
  if curl -s -o /dev/null --max-time 1 "http://localhost:$port/"; then echo "a porta $port está ocupada; pare o que estiver nela" >&2; exit 1; fi
done

echo "1/6 testes automáticos"
# A saída fica em arquivo: se algum teste falhar, o script diz qual (antes, parava calado).
(cd "$ROOT/backend" && npx vitest run >"$OUT/testes-backend.log" 2>&1) || true
(cd "$ROOT/frontend" && npx vitest run >"$OUT/testes-frontend.log" 2>&1) || true
TB=$(sed -n 's/^ *Tests *\([0-9]*\) passed ([0-9]*)$/\1/p' "$OUT/testes-backend.log" | tail -1)
TF=$(sed -n 's/^ *Tests *\([0-9]*\) passed ([0-9]*)$/\1/p' "$OUT/testes-frontend.log" | tail -1)
if [ -z "$TB" ] || [ -z "$TF" ]; then
  echo "algum teste falhou (logs em $OUT/testes-*.log):" >&2
  grep -h -E '^ *(FAIL|×)' "$OUT/testes-backend.log" "$OUT/testes-frontend.log" | head -20 >&2 || true
  exit 1
fi
echo "   backend $TB, frontend $TF"

echo "2/6 banco limpo e servidores"
(cd "$ROOT/backend" && npm run seed >/dev/null)
redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del >/dev/null
(cd "$ROOT/backend" && exec node src/server.js >"$OUT/api.log" 2>&1) & PIDS+=($!)
wait_up http://localhost:4000/api/health
# Segunda API, com acesso de 5 s, para ver a renovação automática da sessão no navegador.
(cd "$ROOT/backend" && PORT=4030 WORKER_ID=3 ACCESS_TOKEN_TTL_SEC=5 exec node src/server.js >"$OUT/api-curta.log" 2>&1) & PIDS+=($!)
wait_up http://localhost:4030/api/health
(cd "$ROOT/frontend" && npm run build >/dev/null)
(cd "$ROOT/frontend" && BACKEND_URL=http://localhost:4000 exec ./node_modules/.bin/vite preview --port 4173 --strictPort >"$OUT/web.log" 2>&1) & PIDS+=($!)
(cd "$ROOT/frontend" && BACKEND_URL=http://localhost:4030 exec ./node_modules/.bin/vite preview --port 4175 --strictPort >"$OUT/web-curta.log" 2>&1) & PIDS+=($!)
wait_up http://localhost:4173/; wait_up http://localhost:4175/

echo "3/6 passo a passo na API"
node "$HERE/walk.mjs" "$OUT" "$OUT/api.log" | tail -1

echo "4/6 sessão no navegador"
node "$HERE/e2e.cjs" | grep -v '^post msg' | tee "$OUT/e2e-out.txt" | grep -c '^OK' | sed 's/^/   passos ok: /'

echo "5/6 telas"
(cd "$ROOT/backend" && npm run seed >/dev/null)
redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del >/dev/null
node "$HERE/shots.cjs" "$OUT" >/dev/null

echo "6/6 páginas"
VERSION="versão da main após o PR #$(git -C "$ROOT" log -1 --merges --format=%s | sed -n 's/.*#\([0-9]*\).*/\1/p')"
python3 "$HERE/build.py" "$OUT" "$TB" "$TF" "$VERSION" >/dev/null
python3 "$HERE/demo.py" "$OUT" >/dev/null
(cd "$ROOT/backend" && npm run seed >/dev/null)
grep -c '^FAIL' "$OUT/e2e-out.txt" >/dev/null && echo "atenção: há passos que falharam no navegador" >&2 || true
python3 -c "import json,sys;d=json.load(open('$OUT/results.json'));f=[x for x in d if not x['ok']];print('   API:',len(d)-len(f),'de',len(d));[print('   FALHOU:',x['area'],'|',x['step'],'|',x['detail']) for x in f]"
echo "pronto: $OUT/analise-agora.html e $OUT/agora-demo.html"
