import { setupTestDatabase, cleanupTestDatabase, truncateAll, databaseAvailable, migrateTestDatabase } from './test-db.js';
import { startTestServer } from './test-app.js';

/**
 * A ready-to-use fixture for the module tests: an isolated schema with the
 * migrations applied, a running server, and a registered patient.
 */
export async function createFixture(label) {
  if (!databaseAvailable()) {
    return { available: false };
  }

  const setup = await setupTestDatabase(label);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = setup.databaseUrl;
  process.env.GROQ_API_KEY = 'test-groq-key';
  await migrateTestDatabase();

  const { app } = await import('../../src/app.js');
  const server = await startTestServer(app);

  async function reset() {
    await truncateAll(setup.databaseUrl);
  }

  async function registerPatient(overrides = {}) {
    const email = overrides.email || `patient-${Math.random().toString(36).slice(2, 8)}@example.com`;
    // Each patient gets its own client, so each has its own cookie jar and
    // therefore its own session.
    const client = server.createClient();
    const response = await client.post('/api/auth/register', {
      fullName: overrides.fullName || 'রহিম উদ্দিন',
      email,
      password: overrides.password || 'testpass123',
    });
    if (response.status !== 201) {
      throw new Error(`Could not register the test patient: ${JSON.stringify(response.body)}`);
    }
    return { client, user: response.body.user, email };
  }

  async function close() {
    await server.close();
    await cleanupTestDatabase(setup);
  }

  return { available: true, server, reset, registerPatient, close, databaseUrl: setup.databaseUrl };
}

/** A minimal but valid PDF with a text layer. */
export function makePdf(lines = ['Hello report']) {
  const escape = (value) => value.replace(/([()\\])/g, '\\$1');
  let content = 'BT\n/F1 10 Tf\n50 780 Td\n';
  for (const line of lines) content += `(${escape(line)}) Tj\n0 -14 Td\n`;
  content += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A one pixel PNG. */
export function makePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}
