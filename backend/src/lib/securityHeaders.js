// Cabeçalhos de proteção para todas as respostas da API. A API só devolve JSON,
// então a política pode ser a mais fechada possível: nada pode ser carregado ou
// executado a partir destas respostas, e nenhum site pode exibi-las num iframe.
export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  // Em HTTPS, o navegador passa a recusar a versão sem cadeado do site.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Respostas de login nunca ficam em cache.
  if (req.path.startsWith('/api/auth')) res.set('Cache-Control', 'no-store');
  next();
}
