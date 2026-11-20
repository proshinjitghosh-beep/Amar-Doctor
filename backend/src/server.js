import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';

const server = app.listen(env.port, () => {
  console.log(`Sheba running at http://localhost:${env.port}`);
  console.log(`AI model: ${env.groqModel}`);
  console.log(`Groq API: ${env.groqApiKey ? 'configured' : 'not configured'}`);
  console.log(`Groq vision (OCR): ${env.groqVisionModel || 'not configured (image reports need manual entry)'}`);
  console.log(`PostgreSQL: ${pool ? 'configured' : 'not configured (chat works; health modules need DATABASE_URL)'}`);
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
