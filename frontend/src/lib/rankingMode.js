import { useEffect, useState } from 'react';
import { api } from './api.js';
import { hasLocalState, importFromServer } from './deviceAlgo.js';

// O algoritmo de cada pessoa (preferências e aprendizado) fica SÓ no aparelho dela.
// Sempre que a pessoa volta ao app, ele é carregado deste aparelho (deviceAlgo.loadState).
//
// Contas antigas, de quando o algoritmo podia ficar no servidor: na primeira volta, o app
// traz o que o servidor tinha (se este aparelho ainda não tiver um algoritmo) e pede ao
// servidor que apague a cópia dele. Depois disso, nada do algoritmo sai do aparelho.

const synced = new Map(); // userId -> Promise<{ source }>
const listeners = new Set();

/**
 * Garante que o algoritmo desta conta está neste aparelho. Uma vez por sessão.
 * source: 'device' (carregado deste aparelho), 'imported' (trazido do servidor agora)
 * ou 'new' (este aparelho ainda não tem um algoritmo desta conta).
 */
export function syncDeviceAlgorithm(userId) {
  if (!synced.has(userId)) {
    const run = (async () => {
      const hadLocal = hasLocalState(userId);
      const prefs = await api('/api/feed/preferencias');
      if (prefs.settings?.ranking_mode && prefs.settings.ranking_mode !== 'device') {
        if (!hadLocal) importFromServer(userId, prefs);
        await api('/api/feed/modo', { method: 'PUT', body: { mode: 'device' } });
        return { source: hadLocal ? 'device' : 'imported' };
      }
      return { source: hadLocal ? 'device' : 'new' };
    })().catch(() => ({ source: hasLocalState(userId) ? 'device' : 'new' }));
    synced.set(userId, run);
    run.then((r) => listeners.forEach((fn) => fn(userId, r)));
  }
  return synced.get(userId);
}

/** Estado da carga do algoritmo deste aparelho: null enquanto carrega. */
export function useDeviceAlgorithm(userId) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    syncDeviceAlgorithm(userId).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [userId]);
  return state;
}

/** Ao sair, esquece só o estado da sessão. O algoritmo continua guardado neste aparelho. */
export function resetDeviceAlgorithmSync() {
  synced.clear();
}
