# English Wordbook — v1 Spec

## Problem

While reading English web pages, I meet new words. I want to save each word together
with where I met it (page URL, title, the sentence) and review my list later, from a
Chrome extension, with the data kept on my own server.

## Success criteria

- Select a word on any normal web page → right-click → "Add to wordbook" → the word,
  page URL, title and sentence are saved on the server in under 2 seconds.
- Type a word in the popup → it is saved with the current tab's URL and title.
- The options page lists my words with search, status filter, note editing and delete.
- A small group (me + a few friends) can each sign up with an invite code and only see
  their own words.
- A failed save is always visible to the user (never silent).

## Scope

**In v1:** login, capture (context menu + popup), wordbook view (options page),
English definitions, status `learning` / `known`.

**Not in v1:** flashcards / spaced repetition, offline queue, floating "add" button on
pages, separate website, Chinese translation, lemmatization, Google sign-in.

## Decisions

### Users and auth
- Audience: personal / small group. Sign-up needs a shared invite code (server env var).
- Email + password. Passwords hashed with Node built-in `crypto.scrypt`.
- Login returns a random opaque session token. Server stores only its hash in `sessions`.
  Sessions expire after 90 days.
- Extension stores the token in `chrome.storage.local`, sends `Authorization: Bearer <token>`.
- `/auth/*` rate-limited to 10 requests/min per IP (`@fastify/rate-limit`).

### Capture
- Context menu "Add to wordbook" on selected text.
- On click, `chrome.scripting.executeScript` (with `activeTab`) reads the selection's
  parent text and cuts out the sentence at `.` `!` `?`. If scripts can't run on the page
  (`chrome://`, PDF viewer, Web Store), save without a sentence.
- Popup: type a word; saved with the active tab's URL + title, no sentence.
- Normalization: trim + lowercase. Phrases allowed, max 100 chars. No lemmatization.
- On failure (server down, logged out): show error badge/notification. No retry queue.

### Definitions
- Server fetches an English definition from dictionaryapi.dev only when a word is new.
  3-second timeout. On failure store `null`; the save still succeeds.
- Each word also has a free-text `note`.

### Highlighting saved words on pages (added 2026-11-03)
- A content script runs on every http(s) page (manifest `content_scripts`). Chrome shows the
  "Read and change all your data on all websites" warning, and existing installs must approve it after updating.
- Highlights `learning` words only. Whole words, any case. Saved phrases match across any whitespace.
  No other word forms ("running" does not match "run").
- Skips `script, style, noscript, textarea, input, select, code, pre, svg` and editable areas.
- Hover shows the first definition and the note (native `title` tooltip).
- New content is found with a `MutationObserver` and scanned at most once every 500 ms.
- Word list: `GET /words/highlight` → cached in `chrome.storage.local` (`highlightWords`). Refreshed on
  install, browser start, every 30 min (`alarms`), and after login, logout, save, edit, or delete from the
  extension. Open tabs re-highlight when the cache changes.

### Data model (PostgreSQL)

```
users      id, email (unique, lowercase), password_hash, created_at
sessions   token_hash (PK), user_id → users ON DELETE CASCADE, expires_at
words      id, user_id → users CASCADE, text, status ('learning'|'known'),
           note, definition (jsonb, nullable), created_at, updated_at
           UNIQUE (user_id, text)
sightings  id, word_id → words CASCADE, url, title, sentence (nullable), created_at
           UNIQUE (word_id, url)
```

Saving the same word on the same page twice adds nothing.

### API (Fastify)

```
POST   /auth/signup   {email, password, inviteCode}
POST   /auth/login    {email, password} → {token}
POST   /auth/logout
POST   /words         {text, url?, title?, sentence?}   upsert word + add sighting
GET    /words?q=&status=&limit=&offset=
GET    /words/highlight  learning words: [{text, definition (first one) | null, note}]
GET    /words/:id     word + sightings
PATCH  /words/:id     {note?, status?}
DELETE /words/:id
DELETE /sightings/:id
```

Every word/sighting query filters by the session's `user_id`.

### Stack and layout
- pnpm workspace:
  - `extension/` — WXT (Manifest V3), plain TypeScript + HTML (popup, options page).
    Server URL injected at build time via env var.
  - `server/` — Node + TypeScript + Fastify + Drizzle ORM (migrations from TS schema).
  - `shared/` — zod schemas for request/response bodies, used by both sides.
- No CORS config: the extension calls the server from its service worker, and the server
  origin is in `host_permissions`.
- Hosting: Docker Compose on a VPS — Node app + Postgres + Caddy (auto HTTPS).
  Same compose file runs Postgres for local dev and tests.

### Testing
- Server: Vitest integration tests against real Postgres (Docker). Cover signup/login,
  saving the same word twice, and user isolation.
- Extension: unit test for the sentence-cutting function + manual checklist for the
  context menu and popup.

## Changes made during the build (2026-11-02)
- Node 22.12+ is required (Vite 8, used by WXT and vitest, does not run on Node 20.14). Pinned in `.nvmrc`.
- The dev Postgres listens on localhost:5434 (5432 and 5433 were already in use on the dev machine).
- Saved URLs must be http(s). The extension skips the sighting on other pages (e.g. `chrome://newtab`) instead of failing.
- `POST /auth/signup` returns a token, so the user is logged in right after signing up.
- Added `GET /health` for checks.

## Assumptions
- dictionaryapi.dev works without a key (checked: a real lookup returned a definition). Its rate limits are not documented; the 3s timeout keeps saves working if it is slow or down.
- A VPS with a domain name is available for deployment (not checked).
