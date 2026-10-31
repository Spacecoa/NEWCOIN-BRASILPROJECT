// Roda as simulações de API, uma por vez, cada uma com as próprias contas.
// Uso: node sim/run-api.mjs [--list] [--only 12,13]
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cfg, registry, state } from './lib.mjs';
import './api1.mjs';
import './api2.mjs';
import './api3.mjs';
import './api4.mjs';
import './api5.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',').map(Number)) : null;
const first = registry.filter((s) => !s.last && !s.extra);
const last = registry.filter((s) => s.last);
// As 100 primeiras (S001–S076 aqui, S077–S100 na tela) mantêm o número; as novas começam em S101.
const extra = registry.filter((s) => s.extra).map((s, i) => ({ ...s, n: 101 + i }));
const all = [...[...first, ...last].map((s, i) => ({ ...s, n: i + 1 })), ...extra];
if (args.includes('--list')) {
  all.forEach((s) => console.log(String(s.n).padStart(3, '0'), `[${s.area}]`, s.title));
  console.log('total:', all.length);
  process.exit(0);
}

const out = [];
for (const s of all) {
  if (only && !only.has(s.n)) continue;
  state.sim = String(s.n).padStart(3, '0');
  state.base = s.limited ? cfg.limited : cfg.base;
  state.fiveXX = [];
  // Cada simulação começa com os contadores de limite zerados (elas são independentes).
  if (s.limited || s.n) execSync("redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del >/dev/null");
  const t0 = Date.now();
  let r = { ok: true, detail: '' };
  try {
    const v = await Promise.race([s.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado (90 s)')), 90_000))]);
    if (typeof v === 'string') r.detail = v;
    else if (v) Object.assign(r, { detail: v.detail ?? '', docNote: v.docNote });
    if (state.fiveXX.length) throw new Error(`a API respondeu erro interno (5xx): ${state.fiveXX.slice(0, 3).join('; ')}`);
  } catch (e) {
    r = { ok: false, detail: e.message };
  }
  const rec = { id: `S${state.sim}`, kind: 'api', area: s.area, title: s.title, doc: s.doc, ok: r.ok, detail: r.detail, docNote: r.docNote, ms: Date.now() - t0 };
  out.push(rec);
  console.log(r.ok ? 'OK  ' : 'FAIL', rec.id, `[${rec.area}]`, rec.title.slice(0, 90), r.ok ? '' : `\n       → ${r.detail}`, `(${rec.ms} ms)`);
}
writeFileSync(process.env.SIM_OUT ?? '/tmp/claude-0/sec/sim-api.json', JSON.stringify(out, null, 1));
const bad = out.filter((x) => !x.ok);
console.log(`\n${out.length - bad.length}/${out.length} passaram; ${bad.length} falharam`);
process.exit(0);
