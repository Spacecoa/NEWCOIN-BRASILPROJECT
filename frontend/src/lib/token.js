import { useEffect, useState } from 'react';
import { api } from './api.js';

// Regras públicas do token (nome, símbolo). Buscadas uma vez por sessão.
const FALLBACK = { name: 'NewCoin', symbol: 'NWC', tip_amount: 1 };
let cached = null;

export function useToken() {
  const [token, setToken] = useState(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    api('/api/token')
      .then((t) => {
        cached = t;
        setToken(t);
      })
      .catch(() => {});
  }, []);
  return token;
}
