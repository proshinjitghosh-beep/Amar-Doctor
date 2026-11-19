import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';

const server = app.listen(env.port, () => {
  console.log(`Sheba running at http://localhost:${env.port}`);
  console.log(`AI model: ${env.geminiModel}`);
  console.log(`Gemini API: ${env.geminiApiKey ? 'configured' : 'not configured'}`);
  console.log(`PostgreSQL: ${pool ? 'configured' : 'not configured (schema is optional for current demo)'}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
