
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

  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  geminiTimeoutMs: boundedInteger(process.env.GEMINI_TIMEOUT_MS, 15000, 5000, 18000),
  geminiMaxRetries: boundedInteger(process.env.GEMINI_MAX_RETRIES, 2, 0, 2),

  databaseUrl: process.env.DATABASE_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
