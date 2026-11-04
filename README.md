# English Wordbook

Chrome extension + server for saving English words with the page and sentence where you
found them. Design: [docs/SPEC.md](docs/SPEC.md).

```
extension/  WXT (Manifest V3) – context menu, popup, options page (the wordbook), page highlighting
server/     Fastify + Drizzle + PostgreSQL
shared/     zod schemas and API types used by both
```

## Requirements

Node 22.12+ (`nvm use` reads `.nvmrc`), pnpm 9, Docker.

## Local development

```sh
cp .env.example .env        # then edit: for local dev, POSTGRES_PASSWORD=wordbook and a matching DATABASE_URL
pnpm install
pnpm db                     # Postgres in Docker on localhost:5434
pnpm dev:server             # API on http://localhost:3000 (runs migrations on start)
pnpm build:ext              # → extension/.output/chrome-mv3
```

Load the extension: `chrome://extensions` → turn on **Developer mode** → **Load unpacked** →
choose `extension/.output/chrome-mv3`. Click the toolbar icon, create an account with your
`INVITE_CODE`, then select a word on any page → right-click → **Add to wordbook**.

`pnpm dev:ext` runs WXT in watch mode with auto-reload instead.

## Tests

```sh
pnpm db && pnpm test        # server integration tests use a separate wordbook_test database
pnpm typecheck
```

Manual checklist for the extension:

- [ ] Sign up with a wrong invite code → error shown; with the right one → add-word form shown
- [ ] Right-click a selected word on a normal page → green ✓ badge; the word appears in the wordbook with URL, title and sentence
- [ ] Same on `chrome://extensions` or a PDF → saved without a sentence
- [ ] Stop the server, save a word → red `!` badge; hover the icon to see "Cannot reach the wordbook server"
- [ ] Popup: type a word → "Saved"; it shows the current tab as a sighting
- [ ] Wordbook page: search, status filter, mark known, edit note (saved on blur), remove a page, delete a word
- [ ] Save a word → it is highlighted on open tabs within a second; hover shows the definition or note
- [ ] Mark it known in the wordbook → the highlight disappears; mark it learning → it comes back
- [ ] The word is not highlighted inside a text box, an editor (e.g. a Google Docs-style page), or code
- [ ] Log out → wordbook page shows the "not logged in" message, and highlights disappear

## Deploy (VPS)

1. Point a DNS record (e.g. `wordbook.example.com`) to the VPS. Open ports 80 and 443.
2. On the VPS: copy the repo, create `.env` with a strong `POSTGRES_PASSWORD`, a new `INVITE_CODE`, and `DOMAIN`.
3. `docker compose --profile prod up -d --build` — Caddy gets the HTTPS certificate automatically.
4. Build the extension for that server and share the folder (or zip) with your friends:

   ```sh
   WXT_API_URL=https://wordbook.example.com pnpm build:ext
   ```

Back up the `pgdata` Docker volume (for example a daily `pg_dump`); it holds all the words.
