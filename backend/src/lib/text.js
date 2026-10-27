// Extração de entidades do texto, como o campo `entities` dos posts do X.
const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_]{3,20})\b/g;

/** Retorna usernames mencionados (minúsculos, sem duplicatas, na ordem em que aparecem). */
export function extractMentions(text) {
  const seen = new Set();
  for (const match of text.matchAll(MENTION_RE)) seen.add(match[2].toLowerCase());
  return [...seen];
}
