import { api } from './api.js';

// Termo de consentimento do piloto (público; docs/16). O cadastro, a página /termo e o aviso
// de termo novo leem o mesmo texto.
let cache = null;
export function loadConsent() {
  cache ??= api('/api/instancia/termo')
    .then((r) => r.data)
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}
