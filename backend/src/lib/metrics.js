// Métricas básicas no formato de texto do Prometheus: pedidos por rota e por classe de
// status, e o tempo de resposta em faixas. Ficam na memória do processo (cada processo tem
// as suas) e servem para enxergar lentidão e erros antes de alguém reclamar.

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const routes = new Map(); // "GET /api/posts/:id" → { status: Map, buckets: [], sum, count }

function routeOf(req) {
  // O padrão da rota (não o endereço com IDs), para não criar uma série por post.
  const r = req.matchedRoute;
  if (r) return `${req.method} ${r.base}${r.path === '/' && r.base ? '' : r.path}`;
  return `${req.method} (sem rota)`;
}

export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  // O Express desfaz req.baseUrl ao sair do roteador (numa resposta de erro, por exemplo).
  // Guarda o prefixo no momento em que a rota é escolhida.
  let route;
  Object.defineProperty(req, 'route', {
    configurable: true,
    get: () => route,
    set: (value) => {
      route = value;
      if (value?.path) req.matchedRoute = { base: req.baseUrl, path: value.path };
    },
  });
  res.on('finish', () => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    const name = routeOf(req);
    let m = routes.get(name);
    if (!m) routes.set(name, (m = { status: new Map(), buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
    const cls = `${Math.floor(res.statusCode / 100)}xx`;
    m.status.set(cls, (m.status.get(cls) ?? 0) + 1);
    BUCKETS.forEach((b, i) => sec <= b && m.buckets[i]++);
    m.sum += sec;
    m.count++;
  });
  next();
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Texto no formato do Prometheus. `gauges` são valores do momento (fila, banco, memória). */
export function renderMetrics(gauges = {}) {
  const out = [
    '# HELP agora_http_requests_total Pedidos HTTP por rota e classe de status.',
    '# TYPE agora_http_requests_total counter',
  ];
  for (const [name, m] of routes) for (const [cls, n] of m.status) out.push(`agora_http_requests_total{route="${esc(name)}",status="${cls}"} ${n}`);
  out.push('# HELP agora_http_request_duration_seconds Tempo de resposta por rota.', '# TYPE agora_http_request_duration_seconds histogram');
  for (const [name, m] of routes) {
    const r = esc(name);
    BUCKETS.forEach((b, i) => out.push(`agora_http_request_duration_seconds_bucket{route="${r}",le="${b}"} ${m.buckets[i]}`));
    out.push(`agora_http_request_duration_seconds_bucket{route="${r}",le="+Inf"} ${m.count}`);
    out.push(`agora_http_request_duration_seconds_sum{route="${r}"} ${m.sum.toFixed(6)}`);
    out.push(`agora_http_request_duration_seconds_count{route="${r}"} ${m.count}`);
  }
  for (const [name, { help, value }] of Object.entries(gauges)) {
    out.push(`# HELP agora_${name} ${help}`, `# TYPE agora_${name} gauge`, `agora_${name} ${value}`);
  }
  return out.join('\n') + '\n';
}

export const resetMetrics = () => routes.clear();
