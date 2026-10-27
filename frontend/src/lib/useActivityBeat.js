import { useEffect } from 'react';
import { api } from './api.js';

const INTERVAL_MS = 60_000;
const IDLE_MS = 2 * 60_000;

/**
 * Conta minutos ATIVOS para a missão "tempo no app": envia 1 sinal por minuto
 * só se a aba está visível e houve toque, tecla ou rolagem nos últimos 2 minutos.
 * O servidor ignora sinais se a pessoa desligou a contagem.
 */
export function useActivityBeat(enabled) {
  useEffect(() => {
    if (!enabled) return;
    let lastInteraction = Date.now();
    const mark = () => {
      lastInteraction = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInteraction < IDLE_MS) {
        api('/api/atividade', { method: 'POST' }).catch(() => {});
      }
    }, INTERVAL_MS);
    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, mark));
    };
  }, [enabled]);
}
