// Request schemas (validated on the server, used for types in the extension)
// and response types shared by both sides.
import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(8, "Password must be at least 8 characters").max(200);

export const loginBody = z.object({ email, password });
export const signupBody = loginBody.extend({ inviteCode: z.string().min(1).max(200) });

export const wordStatus = z.enum(["learning", "known"]);

// Normalize: trim, lowercase, collapse whitespace (selections can contain newlines).
export const wordText = z
  .string()
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Word is empty").max(100, "Word is longer than 100 characters"));

export const saveWordBody = z.object({
  text: wordText,
  url: z.url({ protocol: /^https?$/ }).max(2048).optional(), // http(s) only: the URL becomes a link
  title: z.string().max(500).optional(),
  sentence: z.string().max(1000).optional(),
});

export const listWordsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: wordStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const patchWordBody = z.object({
  note: z.string().max(5000).optional(),
  status: wordStatus.optional(),
});

export type LoginBody = z.input<typeof loginBody>;
export type SignupBody = z.input<typeof signupBody>;
export type SaveWordBody = z.input<typeof saveWordBody>;
export type ListWordsQuery = z.input<typeof listWordsQuery>;
export type PatchWordBody = z.input<typeof patchWordBody>;
export type WordStatus = z.infer<typeof wordStatus>;

export type Definition = {
  phonetic?: string;
  meanings: { partOfSpeech: string; definitions: string[] }[];
};

// Dates arrive as ISO strings after JSON serialization.
export type Word = {
  id: number;
  text: string;
  status: WordStatus;
  note: string;
  definition: Definition | null;
  createdAt: string;
  updatedAt: string;
};

export type Sighting = {
  id: number;
  url: string;
  title: string;
  sentence: string | null;
  createdAt: string;
};

export type WordDetail = Word & { sightings: Sighting[] };
export type WordList = { words: Word[]; total: number };
export type AuthResponse = { token: string };

// GET /words/highlight: the "learning" words the content script highlights on pages.
export type HighlightWord = { text: string; definition: string | null; note: string };
