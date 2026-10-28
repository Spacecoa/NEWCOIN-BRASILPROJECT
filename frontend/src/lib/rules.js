import { api } from './api.js';

// Regras da instância (públicas). Cache curto na memória: a página de regras, o cadastro
// e o painel da moderação leem a mesma lista.
let cache = null;
export function loadRules({ fresh = false } = {}) {
  if (fresh) cache = null;
  cache ??= api('/api/instancia/regras')
    .then((r) => r.data)
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}
export const setRulesCache = (data) => {
  cache = Promise.resolve(data);
};

export const ruleLabel = (rule) => (rule ? `Regra ${rule.position}: ${rule.title}` : '');
