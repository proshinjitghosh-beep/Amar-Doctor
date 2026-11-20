import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, cleanupTestDatabase, truncateAll, databaseAvailable, migrateTestDatabase } from './helpers/test-db.js';

const available = databaseAvailable();
const setup = available ? await setupTestDatabase('auth') : null;

if (setup) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = setup.databaseUrl;
  process.env.GROQ_API_KEY = 'test-key';
  await migrateTestDatabase();
}

const { startTestServer } = await import('./helpers/test-app.js');
const { app } = setup ? await import('../src/app.js') : { app: null };
const { hashPassword, verifyPassword } = setup ? await import('../src/services/auth.service.js') : {};

test.after(async () => {
  if (setup) await cleanupTestDatabase(setup);
});

test('scrypt hashes verify against the original password', { skip: !setup }, async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('the same password produces a different hash each time', { skip: !setup }, async () => {
  const a = await hashPassword('same');
  const b = await hashPassword('same');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same', a), true);
  assert.equal(await verifyPassword('same', b), true);
});

test('register creates an account and sets a session cookie', { skip: !setup }, async () => {
  await truncateAll(setup.databaseUrl);
  const server = await startTestServer(app);
  try {
    const response = await server.client.post('/api/auth/register', {
      fullName: 'রহিম উদ্দিন',
      email: 'rahim@example.com',
      password: 'testpass123',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.user.email, 'rahim@example.com');
    assert.equal(response.body.user.role, 'patient');
    // The password hash must never leave the server.
    assert.equal(response.body.user.passwordHash, undefined);

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.startsWith('amar_session='));
    assert.ok(session, 'a session cookie is set');
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    assert.match(session, /Path=\//i);
  } finally {
    await server.close();
  }
});

test('register rejects a duplicate email', { skip: !setup }, async () => {
  await truncateAll(setup.databaseUrl);
  const server = await startTestServer(app);
  try {
    await server.client.post('/api/auth/register', {
      fullName: 'প্রথম',
      email: 'dup@example.com',
      password: 'testpass123',
    });
    const second = await server.client.post('/api/auth/register', {
      fullName: 'দ্বিতীয়',
      email: 'dup@example.com',
      password: 'testpass123',
    });
    assert.equal(second.status, 409);
  } finally {
    await server.close();
  }
});

test('register rejects a short password', { skip: !setup }, async () => {
  const server = await startTestServer(app);
  try {
    const response = await server.client.post('/api/auth/register', {
      fullName: 'ছোট পাসওয়ার্ড',
      email: 'short@example.com',
      password: 'abc',
    });
    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
});

test('login succeeds with the right password and fails with the wrong one', { skip: !setup }, async () => {
  await truncateAll(setup.databaseUrl);
  const server = await startTestServer(app);
  try {
    await server.client.post('/api/auth/register', {
      fullName: 'লগইন পরীক্ষা',
      email: 'login@example.com',
      password: 'testpass123',
    });

    const wrong = await server.client.post('/api/auth/login', {
      email: 'login@example.com',
      password: 'wrongpass',
    });
    assert.equal(wrong.status, 401);

    const right = await server.client.post('/api/auth/login', {
      email: 'login@example.com',
      password: 'testpass123',
    });
    assert.equal(right.status, 200);
    assert.equal(right.body.user.email, 'login@example.com');
  } finally {
    await server.close();
  }
});

test('an unknown email is rejected without revealing whether the account exists', { skip: !setup }, async () => {
  const server = await startTestServer(app);
  try {
    const response = await server.client.post('/api/auth/login', {
      email: 'nobody@example.com',
      password: 'testpass123',
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।');
  } finally {
    await server.close();
  }
});

test('protected endpoints reject an unauthenticated request', { skip: !setup }, async () => {
  const server = await startTestServer(app);
  try {
    const response = await server.client.get('/api/reports');
    assert.equal(response.status, 401);
    assert.match(response.body.error, /লগইন/);
  } finally {
    await server.close();
  }
});

test('logout revokes the session', { skip: !setup }, async () => {
  await truncateAll(setup.databaseUrl);
  const server = await startTestServer(app);
  try {
    await server.client.post('/api/auth/register', {
      fullName: 'লগআউট',
      email: 'out@example.com',
      password: 'testpass123',
    });
    assert.equal((await server.client.get('/api/auth/me')).status, 200);

    const logout = await server.client.post('/api/auth/logout');
    assert.equal(logout.status, 200);

    assert.equal((await server.client.get('/api/auth/me')).status, 401);
  } finally {
    await server.close();
  }
});

test('logout-all revokes every session for the user', { skip: !setup }, async () => {
  await truncateAll(setup.databaseUrl);
  const server = await startTestServer(app);
  try {
    await server.client.post('/api/auth/register', {
      fullName: 'সব সেশন',
      email: 'all@example.com',
      password: 'testpass123',
    });

    // A second client logs in on the same account.
    const other = server.client;
    await other.post('/api/auth/login', { email: 'all@example.com', password: 'testpass123' });

    const logoutAll = await server.client.post('/api/auth/logout-all');
    assert.equal(logoutAll.status, 200);

    assert.equal((await server.client.get('/api/auth/me')).status, 401);
  } finally {
    await server.close();
  }
});
