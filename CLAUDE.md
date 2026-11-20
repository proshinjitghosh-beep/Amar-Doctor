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
npm run db:seed      # creates the demo account with labelled sample records
```

Run a single test file: `node --test backend/tests/triage.test.js`. Run one test by name: `node --test --test-name-pattern="detects Bangla" backend/tests/triage.test.js`.

Tests use the built-in `node:test` runner (no framework). They stub `globalThis.fetch` and set `process.env.NODE_ENV='test'` before importing the service under test — `backend/src/config/env.js` skips `dotenv` in test mode, so set env vars in the test file itself.

**The database-backed tests SKIP rather than fail when no database is configured.** A green `npm test` on its own
proves nothing. Run them with the database named explicitly:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/amar_doctor npm test
```

and check the summary reports 75 passing and **0 skipped**.

## Architecture

Request path: `backend/src/server.js` (listen + graceful shutdown) → `backend/src/app.js` (Express wiring: helmet, CORS, JSON body limit 32kb, rate limiters, static file serving) → `routes/` → `controllers/` → `services/` → `utils/`.

- `backend/src/app.js` is the single Express app. It is also the Vercel entrypoint: `api/index.js` re-exports `app`, and `vercel.json` rewrites `/(.*)` → `/api/index.js`. `app.set('trust proxy', 1)` — exactly one proxy hop (Vercel); do not loosen this, rate limiting depends on it.
- `routes/` — thin Express routers only. `chat.routes.js` (validate → controller), `health.routes.js`, `signaling.routes.js` (in-memory WebRTC signaling relay; state lives in a `Map` in the router module, so it is per-instance and lost on restart).
- `middleware/validate-chat.js` — zod schema: `messages[]` of `{role: user|assistant, content: 1–4000 chars}`, max 30 messages. Rejects with 400.
- `controllers/chat.controller.js` — finds the latest user message, runs the emergency red-flag check, and only then calls the AI service. The emergency path never touches the provider.
- `services/` — **Groq is the only AI provider**:
  - `groq.service.js` — the active provider. Calls **Groq** (`api.groq.com/openai/v1/chat/completions`) using `GROQ_API_KEY` / `GROQ_MODEL` (default `openai/gpt-oss-120b`), plus `GROQ_VISION_MODEL` for reading text out of images and scanned PDFs. There is no Gemini or DeepSeek client in this repository.
  - `ai.service.js` — the shared safety layer (`SAFETY_RULES`) plus `generateStructured()`, which forces the model to return JSON matching a zod schema, makes one repair attempt, and throws rather than returning a malformed reply.
- The chat contract is load-bearing: the model is forced to return **JSON only** (`response_format`) shaped `{reply, sp, em}`, and `sp` is validated against a fixed specialist allowlist, falling back to `null`. Preserve it — the frontend renders `r.sp` as a booking button and `r.em` as the emergency style.
- `services/report-analysis.service.js` forces a JSON schema that deliberately has **no field for a value, unit, reference range or status**. The AI can only explain values; it can never supply or change one. Status is always the server's own deterministic comparison against the range printed in the document.
- `utils/triage.js` — keyword red-flag matcher (English + Bangla regexes) and the canned emergency reply that tells the user to call 999. The Bangla patterns allow an optional severity word between the body part and the symptom ("বুকে প্রচণ্ড ব্যথা"), because that is how a serious complaint is usually written. This is a safety net only, not clinical triage (see `docs/SAFETY.md`).
- `utils/http-error.js` — `HttpError(status, message)`; `middleware/error-handler.js` converts it to JSON and logs only 5xx.
- `config/env.js` — loads dotenv (skipped when `NODE_ENV=test`), clamps `GROQ_TIMEOUT_MS` (5k–120k) and `GROQ_MAX_RETRIES` (0–3), and **throws at boot in production if `GROQ_API_KEY` is missing**.
- `config/database.js` — Postgres `Pool` created only when `DATABASE_URL` is set; `pool` is `null` otherwise and the whole app must keep working without a database.

### AI provider — Groq only

`README.md` and `.env.example` document Groq and match the code. If you change providers, update both together
with the env vars in `config/env.js`. There is no `gemini.service.js` and no `deepseek.service.js`.

### Auth

Server-side opaque sessions, not JWT. `auth.service.js` stores only the SHA-256 hash of the token in
`sessions.token_hash` and delivers the raw token in an `HttpOnly`, `SameSite=Lax` cookie named `amar_session`
(`Secure` added in production). `middleware/authentication.js` accepts the cookie or `Authorization: Bearer`.
Passwords use scrypt with a per-user salt and `timingSafeEqual`.

`requireAuth` is mandatory on every healthcare-module route — medical records must never accept an unverified
identity. `middleware/ownership-check.js` provides `assertOwner()`, which returns **404, not 403**, so the API
never confirms that another patient's record exists.

There is **no role-based authorization**: `authenticateUser` filters `role = 'patient'`, so no doctor can sign
in and there are no clinician-facing routes.

### Frontend

`frontend/public/` is the served static root (`express.static` points at `frontend/public`; `/` → `frontend/public/index.html`). It is plain HTML + one CSS file + two JS files — no build step, no framework. The root-level `public/` duplicate has been **deleted**; there is one copy only.

`frontend/public/js/app.js` holds shared page logic: `LS` (localStorage wrapper), the `DOCS` demo-doctor list, the `NAV` list used to build the top nav and the mobile bottom tab bar, `toast()`, `triage(text, hist)` and `book(doc, slot)`.

`frontend/public/js/health.js` holds the `H` helper shared by the healthcare modules: `api()` (the only fetch wrapper), `loadMe()`, `isSignedIn()`, `gate()`, `ready()`, `loading()`, `empty()`, `errorNote()` and the Bangla date/time formatters. The four module pages (`reports.html`, `medications.html`, `emergency.html`, `doctor-prep.html`) and `shared.html` load it; the older pages do not.

Each page's own logic is inline in a `<script>` block at the bottom of its HTML file (`consult.html` drives the chat UI, `index.html` the hero animation). Adding a page means adding a file to `frontend/public` **and** an entry to `NAV` in `app.js`.

Design tokens are CSS custom properties in `frontend/public/css/style.css` (`--bg`, `--pp`, `--ink`, `--mu`, `--r`, `--g`, `--ln`, plus `--mono` for tabular figures) with a `prefers-color-scheme: dark` override — change colors there, not inline. The healthcare modules extend the base with a "Clinical Ledger" layer: `.sheet`, `.sec`, `.pill`, `.lab`, `.tl`, `.meter`, `.drop`, `.note`, `.stamp`, and an inverted `.emg` emergency mode.

### Database

`database/migrations/001_initial_schema.sql` — `users`, `doctor_profiles`, `appointments`, `consultations`, `medical_records`.
`database/migrations/002_health_modules.sql` — the healthcare module tables (`sessions`, `health_profiles`, `symptoms`, `medications`, `medicine_schedules`, `dose_logs`, `medical_reports`, `report_results`, `emergency_profiles`, `emergency_contacts`, `emergency_events`, `emergency_event_notifications`, `visit_summaries`, `share_links`, `notifications`, `push_subscriptions`, `audit_logs`) and the seed of the eight demo doctors.

The migration runner (`backend/src/utils/migrate.js`) applies every `.sql` file in sorted order, in a transaction, and records a SHA-256 checksum per file in a `schema_migrations` table. Running it twice is a no-op, and **editing an already-applied migration is refused** — add a new numbered file instead.

Uploaded reports are stored as `BYTEA` in `medical_reports.file_data`, never on disk, and are only readable through the authenticated `GET /api/reports/:id/download`. They are never served from a public static path.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/chat` | `{messages:[{role,content}]}` → `{reply, sp, em}` |
| GET/POST | `/api/sig/:roomId` | Video signaling relay (in-memory) |
| POST | `/api/auth/register` · `/api/auth/login` · `/api/auth/logout` | Session cookie (`amar_session`) |
| GET | `/api/auth/me` | Current user |
| GET/PUT | `/api/health-profile` · `/api/health-profile/symptoms` | Health profile and symptoms |
| GET/POST | `/api/reports` · `/api/reports/upload` | Report list and upload |
| GET/POST/PATCH/DELETE | `/api/reports/:id` · `/:id/analyze` · `/:id/ask` · `/:id/results` · `/:id/download` | Report detail, AI analysis, Q&A, result entry, download |
| GET/POST/PUT/DELETE | `/api/medications` · `/:id` | Medicines |
| GET | `/api/medications/adherence` · `/api/medications/refill-status` | Adherence and refill estimate |
| POST | `/api/medications/extract-prescription` · `/api/medications/import-prescription` | Prescription candidates to review |
| GET/POST/PUT/DELETE | `/api/reminders` · `/:id` · `/:id/taken` · `/:id/skipped` · `/:id/snooze` | Dose schedule and dose status |
| GET/PUT/POST/DELETE | `/api/emergency/profile` · `/contacts` · `/activate` · `/:id/notify` · `/:id/resolve` · `/history` · `/hospitals` | Emergency assistance |
| GET/POST/PUT | `/api/doctor-prep` · `/create` · `/:id` · `/:id/approve` · `/:id/regenerate` · `/:id/export` · `/:id/share` · `/:id/revoke-share/:shareId` | Visit preparation |
| GET | `/api/shared` | Public read of a shared summary (token) |
| GET/POST | `/api/appointments` | Appointments |
| GET | `/api/notifications` | In-app notifications |
| GET/POST | `/api/internal/reminders/dispatch` | Cron endpoint (Bearer `CRON_SECRET`) |

Rate limits: 300 req / 15 min on `/api`, 10 req / min on `/api/chat`, 10 req / 15 min on auth, 20 req / 15 min on uploads.

## Deploy

Vercel: `api/index.js` exports the Express `app`; `vercel.json` routes everything to it with a 60s function timeout and schedules a daily cron for `/api/internal/reminders/dispatch`. Set `GROQ_API_KEY` (and optionally `GROQ_MODEL`) in Vercel env vars — production boot fails without it. `CRON_SECRET` must be set too, or the cron endpoint returns 503. Never put secrets in `vercel.json` or frontend files.

## Safety constraints

`docs/SAFETY.md` is binding on this project:
- Never diagnose, prescribe, or give medication/antibiotic dosages.
- Escalate possible emergencies immediately (Bangladesh emergency number **999**), don't keep chatting.
- Emergency keyword matching misses emergencies — it is not a validated triage system.
- Don't send identifying patient data to the model.
- Clinical, security, privacy/legal, and Bangladesh regulatory review are required before real deployment.

Frontend copy must keep the "general advice, not a diagnosis" disclaimer, and must never claim a capability the
app does not have (it does not dispatch an ambulance, contact a contact on the patient's behalf, or deliver a
reminder when the app is closed).
