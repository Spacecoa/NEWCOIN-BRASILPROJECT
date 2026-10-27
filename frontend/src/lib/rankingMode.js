import { useEffect, useState } from 'react';
import { api } from './api.js';

// Onde o feed "Para você" é calculado: 'server' (instância) ou 'device' (este navegador).
// Guardado no servidor (só o modo, nenhuma preferência) e em cache aqui.
let cached = null;
const listeners = new Set();

export const getCachedMode = () => cached;

export function resetCachedMode() {
  cached = null;
}

export function setCachedMode(mode) {
  cached = mode;
  listeners.forEach((fn) => fn(mode));
}

export function useRankingMode() {
  const [mode, setMode] = useState(cached);
  useEffect(() => {
    listeners.add(setMode);
    if (!cached) {
      api('/api/feed/preferencias')
        .then((r) => setCachedMode(r.settings.ranking_mode ?? 'server'))
        .catch(() => setCachedMode('server'));
    }
    return () => listeners.delete(setMode);
  }, []);
  return mode;
}
