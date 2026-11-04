import { buildApp } from "./app";
import { createDb, migrateDb } from "./db";
import { lookupDefinition } from "./definition";

const { DATABASE_URL, INVITE_CODE, PORT = "3000" } = process.env;
if (!DATABASE_URL || !INVITE_CODE) {
  console.error("DATABASE_URL and INVITE_CODE must be set (see .env.example)");
  process.exit(1);
}
// Refuse the placeholders from .env.example, so a copied file is never deployed as-is.
if (DATABASE_URL.includes("change-me") || INVITE_CODE.includes("change-me")) {
  console.error("Replace the change-me placeholders in .env before starting the server");
  process.exit(1);
}

const { db } = createDb(DATABASE_URL);
// shortcut: migrations run at startup, fine for one server instance; move to a deploy step if you scale out.
await migrateDb(db);

const app = await buildApp({ db, inviteCode: INVITE_CODE, lookup: lookupDefinition, logger: true });
await app.listen({ host: "0.0.0.0", port: Number(PORT) });
