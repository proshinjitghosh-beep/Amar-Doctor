# আমার ডাক্তার (Amar Doctor) / Sheba

A Bangla-first AI health-triage and doctor-booking prototype for Bangladesh, with four connected healthcare
modules: **medical report analysis**, **smart medicine reminders**, **emergency assistance** and **AI doctor
visit preparation**.

Sheba helps people understand their health concerns in their own language, recognise warning signs early, keep
track of their own medical records, and arrive at a doctor's appointment prepared. It is designed to support
healthcare decisions — not to replace qualified medical professionals.

---

## 1. Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ (ES modules) |
| Backend | Express 4 |
| Database | PostgreSQL 15+ (via `pg`) |
| AI provider | **Groq** — `api.groq.com` (`gpt-oss-120b` by default) |
| Frontend | Plain HTML, CSS and vanilla JavaScript — **no build step, no framework** |
| Uploads | `multer` (in memory) + `pdf-parse` for text PDFs |
| Auth | Server-side opaque sessions in an `HttpOnly` cookie, scrypt password hashing |
| Tests | The Node.js built-in `node:test` runner — no test framework dependency |
| Deploy | Vercel (`api/index.js` re-exports the Express app) |

> Groq is the **only** AI provider in this repository. There is no Gemini or DeepSeek client.

---

## 2. Features

**Core**
- **AI ডাক্তার** — conversational triage in Bangla or English. Emergency red flags are checked **before** the
  AI is called, so a possible emergency is escalated to **999** immediately and never waits on a network request.
- **ডাক্তার খুঁজুন** — find a specialist by name or department, pick a slot, book.
- **Emergency awareness** — a prominent 999 call action that is a plain `tel:` link and works with no internet.

**The four healthcare modules**

| Module | What it does |
|---|---|
| 📄 **AI Medical Report Analyzer** (`reports.html`) | Upload a PDF or image report. The server reads the text layer out of a PDF and extracts the lab values **with their printed reference ranges**. Groq explains the values in plain Bangla. Values the server could not read can be typed in by hand. Saved reports can be reopened. |
| 💊 **Smart Medicine Reminder** (`medications.html`) | Add a medicine and the times you take it, edit its name, dose and quantity later, see today's dose timeline, mark a dose taken / skipped / snoozed, track adherence, and get a reminder while the app is open. A prescription photo or PDF can be read into candidate medicines — **as candidates to review, never as a prescription**. |
| 🚨 **Emergency Health Assistance** (`emergency.html`) | A prominent 999 call button, an SOS flow, your blood group / allergies / conditions, trusted contacts you can call, and nearby hospitals. The app **does not** dispatch an ambulance and does not contact anyone on your behalf — it prepares a message for you to send. |
| 🗒️ **AI Doctor Visit Preparation** (`doctor-prep.html`) | Write your symptoms and concerns — they are saved to your own health record — then collect them with your history, current medicines and reports into a structured summary you can read, edit and approve before a consultation — plus a shareable, revocable link for whoever will see you. |

**Accounts** — register, sign in, sign out; health profile; symptoms; appointments; notifications.

---

## 3. Prerequisites

- **Node.js 20 or newer** (`node -v`)
- **npm** (bundled with Node)
- **PostgreSQL 15 or newer** — either installed locally or run in Docker
- **A Groq API key** — optional for demo mode, required for the AI features

---

## 4. Installation

```bash
git clone YOUR_REPOSITORY_URL
cd Amar-Doctor-Pro-Backup
npm install
```

---

## 5. PostgreSQL setup

The quickest route is a Docker container:

```bash
docker run --name amar-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=amar_doctor -p 5432:5432 -d postgres:16
```

**Reusing a container that already exists** — do not start a second one on the same port:

```bash
docker ps -a                      # list containers, note the name
docker start amar-pg              # start the existing one
docker exec -it amar-pg psql -U postgres -d amar_doctor   # check it is up
```

If you already have PostgreSQL running locally, point `DATABASE_URL` at it instead — the connection string is
all that matters.

---

## 6. Environment configuration

```bash
cp .env.example .env
```

`.env.example` documents every variable the server reads, with what it does and whether the app can run without
it. The ones you must fill in:

```env
GROQ_API_KEY=gsk_...                      # for the AI features
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/amar_doctor
```

`SESSION_TTL_DAYS`, `UPLOAD_MAX_BYTES`, the `*_RATE_LIMIT` knobs, `VAP_*` (web push), `CRON_SECRET` and
`EMERGENCY_REGION` all have sensible defaults and can be left alone.

**Never commit `.env`.** It is gitignored. Never put a key in a frontend file, in `vercel.json`, or in a
screenshot.

---

## 7. Database migrations

```bash
npm run db:migrate
```

The runner applies every file in `database/migrations/` that has not been applied yet, in filename order, each in
its own transaction. It records a SHA-256 checksum of each applied file in a `schema_migrations` table, so:

- running it twice is a no-op ("Database is up to date");
- **editing an already-applied migration is refused** — write a new numbered file instead.

Migrations `001` and `002` create the schema and seed the eight demo doctors, so `npm run db:migrate` is enough
to get a working database.

---

## 8. Running the app

```bash
npm run dev      # node --watch — restarts on change
npm start        # node — plain run
```

Then open **http://localhost:3000**.

```bash
npm run db:seed         # optional: one demo account with clearly-labelled sample records
npm run reminders:dispatch   # optional: run the reminder dispatcher once, by hand
```

`npm run db:seed` creates one patient account and a small set of sample records so the four healthcare modules
have something to show. It prints the credentials it used:

```
ইমেইল    : demo@amar-doctor.test
পাসওয়ার্ড: demo12345
```

Every sample record has the word **"ডেমো"** in its name, so it is obvious in the interface that a record is
sample data and not something the patient entered. Running the seed twice is safe — the account and each record
are looked up before they are created.

---

## 9. Running the tests

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/amar_doctor npm test
```

Each database-backed test file creates its own isolated schema (`test_<name>_<pid>`) and drops it afterwards, so
files can run in parallel without interfering.

> **Read this before trusting a green run.** If neither `TEST_DATABASE_URL` nor `DATABASE_URL` is set, the
> database-backed tests **skip** rather than fail, and `npm test` still exits 0. Always pass the variable above
> and check the summary reports 75 passing and **0 skipped**.

Run one file, or one test by name:

```bash
node --test backend/tests/reports.test.js
node --test --test-name-pattern="detects Bangla" backend/tests/triage.test.js
```

---

## 10. Groq API configuration

1. Create a key at **https://console.groq.com/keys**.
2. Put it in `.env` as `GROQ_API_KEY=...`.
3. Restart the server.

The model is chosen with `GROQ_MODEL` (default `openai/gpt-oss-120b`). The chat, the report explanation and the
visit summary all use it.

For **image and scanned-PDF reports** you also need a vision model, e.g. `GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct`.
Text PDFs do not need it — those are parsed with `pdf-parse` and never touch the AI.

Every AI response is forced into a JSON contract and validated before it is stored. A malformed model reply is
discarded and reported as an error; it is never patched up with invented values.

---

## 11. Demo-mode limitations

Without a Groq key the application still runs and every page still works. What changes:

| Feature | Without a Groq key |
|---|---|
| AI ডাক্তার chat | The keyword emergency check still works and still escalates to 999. General advice falls back to a local keyword heuristic, clearly labelled. |
| Report analysis | The report is stored and the **server-side value extraction still works** — values, units and reference ranges are read from the PDF deterministically. Only the plain-Bangla AI explanation is unavailable. |
| Visit preparation | A summary is still built, from your own records, using the manual template — with a notice saying the AI was unavailable. |
| Report OCR (images) | Needs `GROQ_VISION_MODEL`. Without it the image is stored but nothing can be read out of it, and the page offers manual entry. |
| Medicine reminders | Work fully as an in-app schedule. Browser notifications fire **while the app is open**. Background push needs VAP keys. |

Other honest limitations:

- **The app never dispatches an ambulance** and never contacts your contacts for you. The emergency module
  prepares a message and a map link; you make the call.
- **Keyword emergency matching is a safety net, not a triage system.** It catches obvious red flags and misses
  others. It is not a validated clinical tool.
- **This is a prototype, not a medical device.** It has had no clinical, security, privacy or regulatory review.
- The doctor console (`doctor.html`) and payment page (`payment.html`) are labelled demos.
- `later/video.html` is an orphaned WebRTC prototype.
- There is **no clinician workflow yet**: no doctor can sign in, so nothing here is clinician-verified.

---

## 12. Hackathon demo walkthrough

1. **Homepage** — `http://localhost:3000`. The pitch, and the AI ডাক্তার entry point.
2. **Sign in** — open any healthcare module; the inline panel registers or signs you in against the real API.
   (Alternatively `npm run db:seed` and use the printed demo credentials.)
3. **Health profile** — your blood group, allergies and conditions.
4. **Triage** — on *AI ডাক্তার*, type a symptom. Try `বুকে ব্যথা` to watch the emergency path escalate to 999
   **without** calling the AI.
5. **Report analysis** — upload a PDF lab report. The values and reference ranges are extracted on the server;
   the Bangla explanation is the AI layer (or the honest fallback).
6. **Medicine reminder** — add a medicine and a time; the timeline appears immediately.
7. **Emergency assistance** — show the 999 call button and the SOS confirmation, and read the note explaining
   exactly what the SOS button does and does not do.
8. **Visit preparation** — write your symptoms in the box at the top (they are saved to your own health record),
   pick an appointment, generate the summary, edit a line, approve it, share it, and open the shared link.
9. **Everything is still there** — reopen each module; the records are in PostgreSQL, not in the browser.

---

## 13. Medical safety

`docs/SAFETY.md` is binding on this project. In short:

- The AI is **not a doctor**. It must never diagnose, prescribe, or give medication or antibiotic dosages.
- Possible emergencies are escalated to **999** immediately. An AI call must never delay that.
- Keyword matching is a basic safety net that can miss emergencies.
- Identifying patient data is never sent to the model.
- Clinical, security, privacy/legal and Bangladesh regulatory review are required before any real deployment.

Every AI-backed screen keeps the "general advice, not a diagnosis" disclaimer.

---

## Project layout

```
frontend/public/       static pages, one CSS file, two shared JS files (no build step)
backend/src/
  routes/              thin Express routers
  controllers/         request/response handling
  services/            Groq, OCR, report parsing, reminders, emergency, audit
  repositories/        SQL, always scoped by user id
  middleware/          auth, ownership, rate limits, upload validation, errors
  config/              environment and database pool
  utils/               triage, migration runner, validation helpers
database/migrations/   numbered SQL files, applied in order and checksummed
backend/tests/         node:test suites and their helpers
docs/                  architecture and the binding safety rules
api/index.js           Vercel serverless entrypoint
```

---

## License

Prototype project built for a hackathon.
