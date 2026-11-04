import type {
  AuthResponse,
  HighlightWord,
  ListWordsQuery,
  LoginBody,
  PatchWordBody,
  SaveWordBody,
  SignupBody,
  Word,
  WordDetail,
  WordList,
} from "@wordbook/shared";

declare const __API_URL__: string;

export const getToken = async () => (await browser.storage.local.get("token")).token as string | undefined;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(__API_URL__ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("Cannot reach the wordbook server");
  }
  if (res.status === 401 && token) await browser.storage.local.remove("token");
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`);
  return data as T;
}

const saveToken = async ({ token }: AuthResponse) => {
  await browser.storage.local.set({ token });
  void refreshHighlights();
};

// Cache the words the content script highlights. On a network error keep the old cache;
// when logged out, clear it.
export async function refreshHighlights() {
  let highlightWords: HighlightWord[] = [];
  try {
    if (await getToken()) highlightWords = await call<HighlightWord[]>("GET", "/words/highlight");
  } catch {
    if (await getToken()) return;
  }
  await browser.storage.local.set({ highlightWords });
}

// Run a change, then refresh the highlight cache in the background.
const thenRefresh = async <T>(p: Promise<T>) => {
  const result = await p;
  void refreshHighlights();
  return result;
};

export const api = {
  signup: async (b: SignupBody) => saveToken(await call<AuthResponse>("POST", "/auth/signup", b)),
  login: async (b: LoginBody) => saveToken(await call<AuthResponse>("POST", "/auth/login", b)),
  logout: async () => {
    await call("POST", "/auth/logout").catch(() => {}); // log out locally even if the server is down
    await browser.storage.local.remove("token");
    await refreshHighlights();
  },
  saveWord: (b: SaveWordBody) => thenRefresh(call<Word>("POST", "/words", b)),
  listWords: (q: ListWordsQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
    return call<WordList>("GET", `/words?${params}`);
  },
  getWord: (id: number) => call<WordDetail>("GET", `/words/${id}`),
  patchWord: (id: number, b: PatchWordBody) => thenRefresh(call<Word>("PATCH", `/words/${id}`, b)),
  deleteWord: (id: number) => thenRefresh(call<void>("DELETE", `/words/${id}`)),
  deleteSighting: (id: number) => call<void>("DELETE", `/sightings/${id}`),
};

// Build the save body from a tab. Drop values the server would reject, instead of failing the save.
export function pageInfo(tab?: { url?: string; title?: string }) {
  const url = tab?.url && /^https?:/.test(tab.url) && tab.url.length <= 2048 ? tab.url : undefined;
  return { url, title: url ? tab?.title?.slice(0, 500) : undefined };
}
