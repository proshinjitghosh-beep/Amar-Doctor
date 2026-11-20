# Architecture

```text
Browser (frontend/public — static pages, no build step)
  |
  | fetch / cookie (amar_session)
  v
Express application (backend/src/app.js)
  |
  +-- routes/       thin Express routers (validate -> controller)
  +-- controllers/  request/response handling
  +-- services/     Groq integration, report parsing, reminders, emergency, doctor-prep
  +-- repositories/ SQL, always scoped by user id
  +-- middleware/   auth, ownership, rate limits, upload validation, errors
  +-- config/       environment and database pool
  +-- utils/        triage matcher, migration runner, validation helpers
  |
  +-- PostgreSQL (schema in database/migrations, checksummed ledger)
```

## Request path

`server.js` (listen + graceful shutdown) → `app.js` (helmet, CORS, 32 KB body limit, rate limiters, static
file serving) → `routes/` → `controllers/` → `services/` / `repositories/` → PostgreSQL.

`app.js` is also the Vercel entrypoint: `api/index.js` re-exports the app and `vercel.json` rewrites
`/(.*)` → `/api/index.js`. `app.set('trust proxy', 1)` is exactly one proxy hop (Vercel) — rate limiting depends
on it, so do not loosen it.

## The AI provider is Groq, and only Groq

`services/groq.service.js` is the only client. It talks to `api.groq.com/openai/v1/chat/completions` using
`GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`) and, for reading text out of images, a separate
`GROQ_VISION_MODEL`. There is no Gemini or DeepSeek client in this repository.

Every AI surface uses `services/ai.service.js`, which forces the model to answer with JSON matching a zod schema
and throws rather than returning a malformed reply:

| Surface | Contract | Schema |
|---|---|---|
| Chat | `{reply, sp, em}` | `sp` is validated against a specialist allowlist and falls back to `null` |
| Report analysis | explanation only | **no field for a value, unit, reference range or status** — the model can only explain |
| Visit summary | structured summary | `summarySchema` |

The report analyzer's schema is the load-bearing one: a value can only come from the server's own deterministic
comparison against the range printed in the document, never from the model.

**Identifying data must not reach the model.** The report analyzer sends values only. The doctor-prep prompt
sends an age band and a neutral patient label — never the name or the date of birth; the name is re-attached
server-side when the summary is rendered or exported.

## Emergency handling comes first

`controllers/chat.controller.js` runs the keyword red-flag matcher (`utils/triage.js`) **before** it calls the
provider, so a possible emergency escalates to 999 without waiting on a network request. The keyword matcher is
a safety net, not a triage system — it misses emergencies. The emergency module's 999 buttons are plain `tel:`
links and never touch the network.

## Authentication and ownership

Server-side opaque sessions, not JWT. `auth.service.js` stores only the SHA-256 hash of the token in
`sessions.token_hash` and delivers the raw token in an `HttpOnly`, `SameSite=Lax` cookie named `amar_session`
(`Secure` in production). `middleware/authentication.js` also accepts `Authorization: Bearer`.

`requireAuth` is mandatory on every healthcare-module route. `middleware/ownership-check.js` provides
`assertOwner()`, which returns **404, not 403**, so the API never confirms that another patient's record exists.

There is **no role-based authorization**: `authenticateUser` filters `role = 'patient'`, so no clinician can sign
in and there are no clinician-facing routes. `POST /api/medications/import-prescription` stamps
`clinician_confirmed` without proving the caller is a clinician — a known pre-deployment gap, recorded in the
README's limitations.

## Why the screens are still HTML

The supplied prototype already contains working page markup and styling. They have been preserved under
`frontend/public` to avoid throwing away the existing UI, and the backend has been separated into maintainable
modules. A React/Vite conversion should be a separate phase so each page can be migrated and tested without
breaking the current experience.

The frontend is plain HTML plus one CSS file and two shared JS files — no build step, no framework. Design
tokens are CSS custom properties in `frontend/public/css/style.css`; the healthcare modules add a "Clinical
Ledger" layer (`.sheet`, `.sec`, `.pill`, `.lab`, `.tl`, `.meter`, `.drop`, `.note`, `.stamp`) and an inverted
`.emg` emergency theme.

## Migrations

`backend/src/utils/migrate.js` applies every `database/migrations/*.sql` file in sorted order, each in a
transaction, and records a SHA-256 checksum per file in `schema_migrations`. Running it twice is a no-op, and
**editing an already-applied migration is refused** — write a new numbered file instead.

## Next phases

1. Role-based authorization and a clinician workflow (`doctor_profiles` / `consultations` / `medical_records`
   are created but unused).
2. A licensed payment provider with server-side verification; never store card PINs.
3. Replace the in-memory video signaling with a managed WebRTC signaling service.
4. Background push delivery (the VAP keys are optional today, so reminders only fire while the app is open).
5. Migrate the existing HTML screens to React/Vite component-by-component if desired.
6. Deployment, monitoring, backups, privacy review and security testing.
