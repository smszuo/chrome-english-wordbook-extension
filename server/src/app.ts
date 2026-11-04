import Fastify, { type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { and, count, desc, eq, gt, ilike, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  type HighlightWord,
  listWordsQuery,
  loginBody,
  patchWordBody,
  saveWordBody,
  signupBody,
} from "@wordbook/shared";
import { hashPassword, hashToken, newToken, verifyPassword } from "./auth";
import type { Db } from "./db";
import { sessions, sightings, users, words } from "./db/schema";
import type { Lookup } from "./definition";

const SESSION_DAYS = 90;
const idParam = z.object({ id: z.coerce.number().int().positive() });

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw fail(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

// Escape LIKE wildcards so a search for "_" or "%" matches literally.
const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export type AppOptions = { db: Db; inviteCode: string; lookup: Lookup; logger?: boolean };

export async function buildApp({ db, inviteCode, lookup, logger = false }: AppOptions) {
  // trustProxy: in production the app is only reachable through Caddy, so X-Forwarded-For is trusted.
  const app = Fastify({ logger, trustProxy: true });
  await app.register(rateLimit, { global: false });
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: "Internal server error" });
    }
    return reply.code(code).send({ error: err.message });
  });

  // Run scrypt even for unknown emails so login time does not reveal which emails exist.
  const dummyHash = await hashPassword("dummy-password");

  async function createSession(userId: number) {
    const token = newToken();
    await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    });
    return token;
  }

  async function auth(req: FastifyRequest): Promise<number> {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw fail(401, "Not logged in");
    const [s] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
    if (!s) throw fail(401, "Session expired, please log in again");
    return s.userId;
  }

  // Every word query goes through this filter, so users never see each other's words.
  const ownWord = (uid: number, id: number) => and(eq(words.id, id), eq(words.userId, uid));

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/signup", authLimit, async (req, reply) => {
    const body = parse(signupBody, req.body);
    if (body.inviteCode !== inviteCode) throw fail(403, "Invalid invite code");
    const [user] = await db
      .insert(users)
      .values({ email: body.email, passwordHash: await hashPassword(body.password) })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) throw fail(409, "This email is already registered");
    return reply.code(201).send({ token: await createSession(user.id) });
  });

  app.post("/auth/login", authLimit, async (req) => {
    const body = parse(loginBody, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    const ok = await verifyPassword(body.password, user?.passwordHash ?? dummyHash);
    if (!user || !ok) throw fail(401, "Wrong email or password");
    return { token: await createSession(user.id) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return reply.code(204).send();
  });

  // Upsert the word, then add a sighting. The definition is fetched only for new words.
  app.post("/words", async (req, reply) => {
    const uid = await auth(req);
    const body = parse(saveWordBody, req.body);

    let [word] = await db
      .insert(words)
      .values({ userId: uid, text: body.text })
      .onConflictDoNothing()
      .returning();
    const isNew = Boolean(word);
    if (isNew) {
      const definition = await lookup(body.text);
      if (definition) {
        [word] = await db.update(words).set({ definition }).where(eq(words.id, word.id)).returning();
      }
    } else {
      [word] = await db
        .select()
        .from(words)
        .where(and(eq(words.userId, uid), eq(words.text, body.text)));
    }

    if (body.url) {
      await db
        .insert(sightings)
        .values({ wordId: word.id, url: body.url, title: body.title ?? "", sentence: body.sentence ?? null })
        .onConflictDoNothing();
    }
    return reply.code(isNew ? 201 : 200).send(word);
  });

  app.get("/words", async (req) => {
    const uid = await auth(req);
    const q = parse(listWordsQuery, req.query);
    const where = and(
      eq(words.userId, uid),
      q.status ? eq(words.status, q.status) : undefined,
      q.q ? ilike(words.text, likePattern(q.q)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(words).where(where).orderBy(desc(words.createdAt), desc(words.id)).limit(q.limit).offset(q.offset),
      db.select({ total: count() }).from(words).where(where),
    ]);
    return { words: rows, total };
  });

  // Static route, so Fastify matches it before /words/:id.
  // shortcut: returns every learning word in one response; add paging if a user has tens of thousands.
  app.get("/words/highlight", async (req): Promise<HighlightWord[]> => {
    const uid = await auth(req);
    const rows = await db
      .select({ text: words.text, definition: words.definition, note: words.note })
      .from(words)
      .where(and(eq(words.userId, uid), eq(words.status, "learning")));
    return rows.map((r) => ({
      text: r.text,
      definition: r.definition?.meanings[0]?.definitions[0] ?? null,
      note: r.note,
    }));
  });

  app.get("/words/:id", async (req) => {
    const uid = await auth(req);
    const { id } = parse(idParam, req.params);
    const [word] = await db.select().from(words).where(ownWord(uid, id));
    if (!word) throw fail(404, "Word not found");
    const list = await db
      .select({ id: sightings.id, url: sightings.url, title: sightings.title, sentence: sightings.sentence, createdAt: sightings.createdAt })
      .from(sightings)
      .where(eq(sightings.wordId, id))
      .orderBy(desc(sightings.createdAt));
    return { ...word, sightings: list };
  });

  app.patch("/words/:id", async (req) => {
    const uid = await auth(req);
    const { id } = parse(idParam, req.params);
    const body = parse(patchWordBody, req.body ?? {});
    const [word] = await db
      .update(words)
      .set({ ...body, updatedAt: new Date() })
      .where(ownWord(uid, id))
      .returning();
    if (!word) throw fail(404, "Word not found");
    return word;
  });

  app.delete("/words/:id", async (req, reply) => {
    const uid = await auth(req);
    const { id } = parse(idParam, req.params);
    const deleted = await db.delete(words).where(ownWord(uid, id)).returning({ id: words.id });
    if (!deleted.length) throw fail(404, "Word not found");
    return reply.code(204).send();
  });

  app.delete("/sightings/:id", async (req, reply) => {
    const uid = await auth(req);
    const { id } = parse(idParam, req.params);
    const deleted = await db
      .delete(sightings)
      .where(
        and(
          eq(sightings.id, id),
          inArray(sightings.wordId, db.select({ id: words.id }).from(words).where(eq(words.userId, uid))),
        ),
      )
      .returning({ id: sightings.id });
    if (!deleted.length) throw fail(404, "Sighting not found");
    return reply.code(204).send();
  });

  return app;
}
