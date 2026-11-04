import type { Definition } from "@wordbook/shared";

export type Lookup = (word: string) => Promise<Definition | null>;

// Free API, no key. Any failure (timeout, 404, odd JSON) returns null so the save still succeeds.
export const lookupDefinition: Lookup = async (word) => {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return null;

    const meanings = data
      .flatMap((entry) => (Array.isArray(entry?.meanings) ? entry.meanings : []))
      .slice(0, 4)
      .map((m) => ({
        partOfSpeech: String(m?.partOfSpeech ?? ""),
        definitions: (Array.isArray(m?.definitions) ? m.definitions : [])
          .slice(0, 3)
          .map((d: { definition?: unknown }) => String(d?.definition ?? "")),
      }));
    if (!meanings.length) return null;

    const phonetic = data.find((e) => typeof e?.phonetic === "string")?.phonetic;
    return phonetic ? { phonetic, meanings } : { meanings };
  } catch {
    return null;
  }
};
