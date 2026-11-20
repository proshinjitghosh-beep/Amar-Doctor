
if (process.env.NODE_ENV !== 'test') {
  await import('dotenv/config');
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.trunc(parsed)))
    : fallback;
}

const requiredForProduction = ['GROQ_API_KEY'];

if (process.env.NODE_ENV === 'production') {
  const missing = requiredForProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),

  // Groq is the only AI provider. `groqModel` is the text model used for chat
  // and structured JSON; `groqVisionModel` is optional and only needed to OCR
  // image / scanned-PDF reports. Both use the same GROQ_API_KEY.
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  groqVisionModel: process.env.GROQ_VISION_MODEL || '',
  groqTimeoutMs: boundedInteger(process.env.GROQ_TIMEOUT_MS, 30000, 5000, 120000),
  groqMaxRetries: boundedInteger(process.env.GROQ_MAX_RETRIES, 2, 0, 3),

  databaseUrl: process.env.DATABASE_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // Server-side sessions for the healthcare modules.
  sessionTtlDays: boundedInteger(process.env.SESSION_TTL_DAYS, 30, 1, 365),

  // Web push (VAP) for medicine reminders. When the keys are absent the app
  // falls back to in-app notifications and says so honestly.
  vapPublicKey: process.env.VAP_PUBLIC_KEY || '',
  vapPrivateKey: process.env.VAP_PRIVATE_KEY || '',
  vapSubject: process.env.VAP_SUBJECT || 'mailto:support@amar-doctor.example',

  // Shared secret for the Vercel Cron -> reminder dispatch endpoint.
  cronSecret: process.env.CRON_SECRET || '',

  emergencyRegion: process.env.EMERGENCY_REGION || 'bd',

  uploadMaxBytes: boundedInteger(process.env.UPLOAD_MAX_BYTES, 8 * 1024 * 1024, 1024, 20 * 1024 * 1024),

  // Rate limits. The test suite issues many requests in a row, so the limits
  // are lifted there; the production values are unchanged.
  isTest: process.env.NODE_ENV === 'test',
  // The general /api limit covers every read the pages make. Each page load
  // spends several of these (session check, health profile, module list), so
  // a low ceiling locks a browsing user out of their own records. The
  // security-sensitive endpoints have their own, much tighter limits.
  apiRateLimit: boundedInteger(process.env.API_RATE_LIMIT, 300, 1, 100000),
  chatRateLimit: boundedInteger(process.env.CHAT_RATE_LIMIT, 10, 1, 100000),
  authRateLimit: boundedInteger(process.env.AUTH_RATE_LIMIT, 10, 1, 100000),
  sessionRateLimit: boundedInteger(process.env.SESSION_RATE_LIMIT, 300, 1, 100000),
  uploadRateLimit: boundedInteger(process.env.UPLOAD_RATE_LIMIT, 20, 1, 100000),
};
