// Lógica pura de sincronização de mensagens por pts (inspirada no MTProto).
// Mantida separada da UI para ser testável.
//
// applyIncoming(state, message) => { state, gap }
//   - pts == lastPts + 1  → anexa (caso normal)
//   - pts <= lastPts      → duplicata (ex.: a mesma mensagem chegou por REST e WebSocket) → ignora
//   - pts >  lastPts + 1  → lacuna detectada → o chamador deve buscar /difference
export function applyIncoming(state, message) {
  if (message.pts <= state.lastPts) return { state, gap: false };
  if (message.pts === state.lastPts + 1) {
    return { state: { messages: [...state.messages, message], lastPts: message.pts }, gap: false };
  }
  return { state, gap: true };
}

/** Aplica o resultado de /difference (mensagens em ordem crescente de pts). */
export function applyDifference(state, messages, pts) {
  const known = new Set(state.messages.map((m) => m.id));
  return {
    messages: [...state.messages, ...messages.filter((m) => !known.has(m.id))],
    lastPts: Math.max(state.lastPts, pts),
  };
}

/** Atualiza contagens vindas do servidor preservando a marcação "reagi" local. */
export function mergeReactions(current, incoming) {
  const mine = new Set(current.filter((r) => r.reacted).map((r) => r.emoji));
  return incoming.map((r) => ({ ...r, reacted: r.reacted ?? mine.has(r.emoji) }));
}
