import type { HighlightWord } from "@wordbook/shared";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Same normalization the server applies to saved words, so a match can be looked up by key.
export const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

// One regex for all words: whole words only, any case, longest first so "look up" wins over "look".
// Spaces in phrases match any whitespace, because page text can wrap across lines.
export function buildPattern(texts: string[]): RegExp | null {
  if (!texts.length) return null;
  const alternatives = [...texts]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRegExp(t).replace(/ /g, "\\s+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

export type Segment = string | { match: string };

// Split text into plain parts and matches. Returns null when nothing matches.
export function splitMatches(text: string, pattern: RegExp): Segment[] | null {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ match: m[0] });
    last = m.index + m[0].length;
  }
  if (!out.length) return null;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Tooltip text shown on hover.
export const hintText = (w: HighlightWord) =>
  [w.definition, w.note && `Note: ${w.note}`].filter(Boolean).join("\n") || "In your wordbook";
