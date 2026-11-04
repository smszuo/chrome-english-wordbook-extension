// Integration tests against a real Postgres (start it with `docker compose up -d db`).
// They use a separate database, wordbook_test, which is created if missing and wiped before each test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app";
import { createDb, migrateDb } from "../src/db";
import type { Lookup } from "../src/definition";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://wordbook:${process.env.POSTGRES_PASSWORD ?? "wordbook"}@localhost:5434/wordbook_test`;

let lookups: string[] = [];
const fakeLookup: Lookup = async (word) => {
  lookups.push(word);
  return word === "unknownword" ? null : { meanings: [{ partOfSpeech: "noun", definitions: [`def of ${word}`] }] };
};

const { db, pool } = createDb(TEST_URL);
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: TEST_URL.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  await admin.query("CREATE DATABASE wordbook_test").catch((e) => {
    if (e.code !== "42P04") throw e; // 42P04 = already exists
  });
  await admin.end();
  await migrateDb(db);
  app = await buildApp({ db, inviteCode: "secret-code", lookup: fakeLookup });
});

beforeEach(async () => {
  lookups = [];
  await db.execute(sql`TRUNCATE users, sessions, words, sightings RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

// Each signup comes from its own IP so the auth rate limit (10/min per IP) never trips other tests.
let ipCounter = 0;
async function signup(email = "a@example.com") {
  const res = await app.inject({
    remoteAddress: `10.0.0.${++ipCounter}`,
    method: "POST",
    url: "/auth/signup",
    payload: { email, password: "password123", inviteCode: "secret-code" },
  });
  expect(res.statusCode).toBe(201);
  return { authorization: `Bearer ${res.json().token}` };
}

describe("auth", () => {
  it("rejects a wrong invite code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "a@example.com", password: "password123", inviteCode: "nope" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("signs up, logs in (email is case-insensitive), and logs out", async () => {
    await signup();
    const dup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "A@example.com", password: "password123", inviteCode: "secret-code" },
    });
    expect(dup.statusCode).toBe(409);

    const bad = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "a@example.com", password: "wrong-pass" } });
    expect(bad.statusCode).toBe(401);

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: " A@Example.com ", password: "password123" } });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().token}` };

    expect((await app.inject({ method: "GET", url: "/words", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/logout", headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/words", headers })).statusCode).toBe(401);
  });

  it("requires a token for word routes", async () => {
    expect((await app.inject({ method: "GET", url: "/words" })).statusCode).toBe(401);
  });
});

describe("words", () => {
  it("saving the same word twice keeps one word, adds sightings per page, and looks up once", async () => {
    const headers = await signup();
    const save = (payload: object) => app.inject({ method: "POST", url: "/words", headers, payload });

    const first = await save({ text: "  Serendipity\n", url: "https://a.com/1", title: "A", sentence: "Pure serendipity." });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ text: "serendipity", status: "learning", definition: { meanings: [{ partOfSpeech: "noun" }] } });

    expect((await save({ text: "serendipity", url: "https://b.com/2" })).statusCode).toBe(200);
    expect((await save({ text: "SERENDIPITY", url: "https://a.com/1" })).statusCode).toBe(200); // same page: no new sighting
    expect(lookups).toEqual(["serendipity"]);

    const detail = await app.inject({ method: "GET", url: `/words/${first.json().id}`, headers });
    expect(detail.json().sightings.map((s: { url: string }) => s.url).sort()).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("saves when the definition lookup finds nothing", async () => {
    const headers = await signup();
    const res = await app.inject({ method: "POST", url: "/words", headers, payload: { text: "unknownword" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().definition).toBeNull();
  });

  it("rejects bad input", async () => {
    const headers = await signup();
    const save = (payload: object) => app.inject({ method: "POST", url: "/words", headers, payload });
    expect((await save({ text: "   " })).statusCode).toBe(400);
    expect((await save({ text: "x".repeat(101) })).statusCode).toBe(400);
    expect((await save({ text: "ok", url: "javascript:alert(1)" })).statusCode).toBe(400);
  });

  it("lists with search, status filter and paging; patches and deletes", async () => {
    const headers = await signup();
    for (const text of ["apple", "pineapple", "banana", "100%_sure"]) {
      await app.inject({ method: "POST", url: "/words", headers, payload: { text } });
    }
    const list = async (query: string) => (await app.inject({ method: "GET", url: `/words?${query}`, headers })).json();

    expect((await list("q=apple")).total).toBe(2);
    expect((await list("q=%25_")).words.map((w: { text: string }) => w.text)).toEqual(["100%_sure"]); // wildcards are literal
    const page = await list("limit=2&offset=0");
    expect(page.words).toHaveLength(2);
    expect(page.total).toBe(4);

    const banana = (await list("q=banana")).words[0];
    const patched = await app.inject({ method: "PATCH", url: `/words/${banana.id}`, headers, payload: { status: "known", note: "yellow" } });
    expect(patched.json()).toMatchObject({ status: "known", note: "yellow" });
    expect((await list("status=known")).words.map((w: { text: string }) => w.text)).toEqual(["banana"]);

    expect((await app.inject({ method: "DELETE", url: `/words/${banana.id}`, headers })).statusCode).toBe(204);
    expect((await list("")).total).toBe(3);
  });
});

describe("highlight list", () => {
  it("returns only my learning words, with the first definition and note", async () => {
    const headers = await signup();
    const other = await signup("other@example.com");
    const save = (h: Record<string, string>, text: string) => app.inject({ method: "POST", url: "/words", headers: h, payload: { text } });
    const known = (await save(headers, "banana")).json();
    await save(headers, "apple");
    await save(headers, "unknownword");
    await save(other, "cherry");
    await app.inject({ method: "PATCH", url: `/words/${known.id}`, headers, payload: { status: "known" } });
    const apple = (await app.inject({ method: "GET", url: "/words?q=apple", headers })).json().words[0];
    await app.inject({ method: "PATCH", url: `/words/${apple.id}`, headers, payload: { note: "red fruit" } });

    const res = await app.inject({ method: "GET", url: "/words/highlight", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().sort((a: { text: string }, b: { text: string }) => a.text.localeCompare(b.text))).toEqual([
      { text: "apple", definition: "def of apple", note: "red fruit" },
      { text: "unknownword", definition: null, note: "" },
    ]);
  });
});

describe("user isolation", () => {
  it("one user cannot read, change or delete another user's words or sightings", async () => {
    const alice = await signup("alice@example.com");
    const bob = await signup("bob@example.com");
    const saved = await app.inject({ method: "POST", url: "/words", headers: alice, payload: { text: "secret", url: "https://a.com" } });
    const id = saved.json().id;
    const sightingId = (await app.inject({ method: "GET", url: `/words/${id}`, headers: alice })).json().sightings[0].id;

    expect((await app.inject({ method: "GET", url: "/words", headers: bob })).json().total).toBe(0);
    expect((await app.inject({ method: "GET", url: `/words/${id}`, headers: bob })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/words/${id}`, headers: bob, payload: { note: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/words/${id}`, headers: bob })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/sightings/${sightingId}`, headers: bob })).statusCode).toBe(404);

    // Bob saving the same text gets his own word.
    expect((await app.inject({ method: "POST", url: "/words", headers: bob, payload: { text: "secret" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "DELETE", url: `/sightings/${sightingId}`, headers: alice })).statusCode).toBe(204);
  });
});

describe("rate limit", () => {
  it("blocks the 11th auth request in a minute", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ remoteAddress: "10.9.9.9", method: "POST", url: "/auth/login", payload: { email: "x@example.com", password: "password123" } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});
