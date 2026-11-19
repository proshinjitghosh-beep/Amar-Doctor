
# Sheba – AI-Powered Healthcare Assistant

Sheba is a Bangla-first, AI-powered healthcare assistance platform designed to make basic health information and healthcare navigation more accessible to people in Bangladesh.

Powered by Google's Gemini AI, Sheba helps users understand their health concerns through conversational AI, receive general health guidance, identify potential warning signs, and find relevant medical specialists.

Sheba is designed to support healthcare decisions, not replace qualified medical professionals.

## Key Features

- **AI Health Assistant:** Conversational health guidance powered by Google Gemini.
- **Bangla-First Experience:** Communicate naturally in Bangla or English.
- **Context-Aware Conversations:** Uses previous messages to provide relevant responses.
- **Symptom-Based Guidance:** Provides general health information and safe self-care suggestions.
- **Emergency Awareness:** Highlights warning signs that may require urgent medical attention.
- **Specialist Recommendations:** Suggests relevant types of medical professionals.
- **Doctor Discovery:** Provides navigation to doctor discovery and booking features.

## Technology Stack

- **Frontend:** HTML, CSS, Vanilla JavaScript
- **Backend:** Node.js, Express.js
- **AI Integration:** Google Gemini API
- **Database Foundation:** PostgreSQL
- **Environment Management:** dotenv

## Project Architecture

- `frontend/public/` – HTML, CSS and JavaScript frontend.
- `backend/src/` – Express backend, routes, controllers, services and utilities.
- `database/migrations/` – PostgreSQL schema foundation.
- `docs/` – Architecture and safety documentation.

## Requirements

- Node.js 20+
- npm
- Google Gemini API key
- PostgreSQL 15+ (optional for the current AI chat demo)

## Local Setup

Clone the repository:

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd Sheba-AI
```

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root and configure:

```env
NODE_ENV=development
PORT=3000

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=15000
GEMINI_MAX_RETRIES=2

DATABASE_URL=postgresql://postgres:password@localhost:5432/amar_doctor
CORS_ORIGIN=http://localhost:3000
```

Start the development server:

```bash
npm run dev
```

Open:

http://localhost:3000

For a normal run:

```bash
npm start
```

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Gemini model identifier (default: `gemini-3.8-flash`) |
| `GEMINI_TIMEOUT_MS` | Timeout per Gemini attempt in milliseconds (5,000–18,000; default: 15,000) |
| `GEMINI_MAX_RETRIES` | Retries for transient provider/network errors (0–2; default: 2) |
| `PORT` | Backend server port |
| `DATABASE_URL` | PostgreSQL connection string |
| `CORS_ORIGIN` | Allowed frontend origin |

Never commit `.env` or expose API keys in frontend code, screenshots, or public repositories.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Backend health check |
| POST | `/api/chat` | AI-powered health guidance |
| GET/POST | `/api/sig/:roomId` | Prototype video signaling relay |

## Vercel Deployment

Set `GEMINI_API_KEY` in the Vercel project environment settings (Production, and Preview if needed). Optionally set `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, and `GEMINI_MAX_RETRIES`; the defaults are `gemini-3.8-flash`, `15000`, and `2`. Do not put secrets in `vercel.json` or frontend files. The `api/index.js` serverless entrypoint routes requests through the existing Express app; the app trusts one proxy hop for Vercel and the function timeout is configured to 60 seconds.

## Testing

Run the project tests:

```bash
npm test
```

## Database

The project includes a PostgreSQL schema foundation.

Database-backed features require a configured PostgreSQL instance and database migrations. Some prototype screens may still use browser localStorage and demo data.

## Medical Safety & Limitations

Sheba is an AI-powered health-information assistant, not a medical diagnostic service.

- It does not replace licensed doctors or professional medical consultation.
- It must not prescribe medication or treatment dosages.
- Users with emergency warning signs should seek urgent medical attention.
- AI-generated information may be inaccurate and should be independently verified.
- Do not submit real patient-identifiable information to the prototype.

Clinical review, security validation, and proper data protection are necessary before production healthcare deployment.

## Vision

Our vision is to make reliable healthcare information easier to understand and professional medical support easier to access through responsible AI.
