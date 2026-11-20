# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"আমার ডাক্তার" (Amar Doctor) / "Sheba" — a Bangla-first AI health-triage and doctor-booking prototype for Bangladesh. Express + Postgres backend, static HTML/vanilla-JS frontend, LLM-backed symptom triage that escalates emergencies (999) and recommends a specialist.

## Commands

```bash
npm install
npm run dev          # node --watch backend/src/server.js  → http://localhost:3000
npm start            # node backend/src/server.js
npm test             # node --test backend/tests/*.test.js
npm run db:migrate   # applies database/migrations/*.sql in filename order
```

Run a single test file: `node --test backend/tests/triage.test.js`. Run one test by name: `node --test --test-name-pattern="detects Bangla" backend/tests/triage.test.js`.

Tests use the built-in `node:test` runner (no framework). They stub `globalThis.fetch` and set `process.env.NODE_ENV='test'` before importing the service under test — `backend/src/config/env.js` skips `dotenv` in test mode, so set env vars in the test file itself.

## Architecture

Request path: `backend/src/server.js` (listen + graceful shutdown) → `backend/src/app.js` (Express wiring: helmet, CORS, JSON body limit 32kb, rate limiters, static file serving) → `routes/` → `controllers/` → `services/` → `utils/`.

- `backend/src/app.js` is the single Express app. It is also the Vercel entrypoint: `api/index.js` re-exports `app`, and `vercel.json` rewrites `/(.*)` → `/api/index.js`. `app.set('trust proxy', 1)` — exactly one proxy hop (Vercel); do not loosen this, rate limiting depends on it.
- `routes/` — thin Express routers only. `chat.routes.js` (validate → controller), `health.routes.js`, `signaling.routes.js` (in-memory WebRTC signaling relay; state lives in a `Map` in the router module, so it is per-instance and lost on restart).
- `middleware/validate-chat.js` — zod schema: `messages[]` of `{role: user|assistant, content: 1–4000 chars}`, max 30 messages. Rejects with 400.
- `controllers/chat.controller.js` — finds the latest user message, runs the emergency red-flag check, and only then calls the AI service. The emergency path never touches the provider.
- `services/` — two LLM clients, only one of which is wired up:
  - `deepseek.service.js` — **the active provider**. Despite the filename it calls **Groq** (`api.groq.com/openai/v1/chat/completions`) using `GROQ_API_KEY` / `GROQ_MODEL` (default `openai/gpt-oss-120b`). The file name is misleading; keep it or rename it consistently, but don't assume "deepseek".
  - `gemini.service.js` — a complete Google Gemini client (`GEMINI_API_KEY`, retry with backoff, `Retry-After` handling, timeout → 504) that is **not imported by any route/controller**. It is exercised only by `backend/tests/gemini.test.js`. It is the intended replacement path if you want to switch providers — wire it in `chat.controller.js` and drop the Gemini env vars.
- Both services force the model to return **JSON only** (`response_format` / `responseMimeType`) shaped `{reply, sp, em}` and validate `sp` against a fixed specialist allowlist, falling back to `null`. Preserve that contract — the frontend renders `r.sp` as a booking button and `r.em` as the emergency style.
- `utils/triage.js` — keyword red-flag matcher (English + Bangla regexes) and the canned emergency reply that tells the user to call 999. This is a safety net only, not clinical triage (see `docs/SAFETY.md`).
- `utils/http-error.js` — `HttpError(status, message)`; `middleware/error-handler.js` converts it to JSON and logs only 5xx.
- `config/env.js` — loads dotenv (skipped when `NODE_ENV=test`), clamps `GEMINI_TIMEOUT_MS` (5k–18k) and `GEMINI_MAX_RETRIES` (0–2), and **throws at boot in production if `GROQ_API_KEY` is missing**.
- `config/database.js` — Postgres `Pool` created only when `DATABASE_URL` is set; `pool` is `null` otherwise and the whole app must keep working without a database.

### Two AI provider configs — beware

`README.md` documents only Gemini, but production boot requires `GROQ_API_KEY` and the live chat path uses Groq. `.env.example` also omits `GROQ_*`. Update `.env.example` and the README together with any provider change.

### Frontend

`frontend/public/` is the served static root (`express.static` points at `frontend/public`; `/` → `frontend/public/index.html`). It is plain HTML + one minified-ish CSS file + one JS file — no build step, no framework.

**`public/` at the repo root is a byte-identical duplicate of `frontend/public/`.** Only `frontend/public` is served. Keep them in sync or delete one; changing one alone silently does nothing.

`frontend/public/js/app.js` holds shared page logic: `LS` (localStorage wrapper), the `DOCS` demo-doctor list, the `NAV` list used to build the top nav and the mobile bottom tab bar, `toast()`, and `triage(text, hist)`. `triage()` POSTs `{messages: [...]}` to `/api/chat` and falls back to a local keyword heuristic if the request fails.

Each page's own logic is inline in a `<script>` block at the bottom of its HTML file (`consult.html` drives the chat UI, `index.html` the hero animation). Adding a page means adding a file to `frontend/public` **and** an entry to `NAV` in `app.js`.

Design tokens are CSS custom properties in `frontend/public/css/style.css` (`--bg`, `--pp`, `--ink`, `--mu`, `--r`, `--g`, `--ln`) with a `prefers-color-scheme: dark` override — change colors there, not inline.

### Database

`database/migrations/001_initial_schema.sql` — `users`, `doctor_profiles`, `appointments`, `consultations`, `medical_records`. The migration runner (`backend/src/utils/migrate.js`) executes every `.sql` file in sorted order with no version tracking, so migrations are not re-runnable once data exists. No backend route queries these tables yet; the UI still uses `localStorage` demo data.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/chat` | `{messages:[{role,content}]}` → `{reply, sp, em}` |
| GET/POST | `/api/sig/:roomId` | Video signaling relay (in-memory) |

Rate limits: 60 req / 15 min on `/api`, 10 req / min on `/api/chat`.

## Deploy

Vercel: `api/index.js` exports the Express `app`; `vercel.json` routes everything to it with a 60s function timeout. Set `GROQ_API_KEY` (and optionally `GROQ_MODEL`) in Vercel env vars — production boot fails without it. Never put secrets in `vercel.json` or frontend files.

## Safety constraints

`docs/SAFETY.md` is binding on this project:
- Never diagnose, prescribe, or give medication/antibiotic dosages.
- Escalate possible emergencies immediately (Bangladesh emergency number **999**), don't keep chatting.
- Emergency keyword matching misses emergencies — it is not a validated triage system.
- Don't send identifying patient data to the model.
- Clinical, security, privacy/legal, and Bangladesh regulatory review are required before real deployment.

Frontend copy must keep the "general advice, not a diagnosis" disclaimer.
