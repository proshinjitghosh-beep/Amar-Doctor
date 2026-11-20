import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key-not-a-real-secret';
process.env.GEMINI_MODEL = 'gemini-3.8-flash';
process.env.GEMINI_MAX_RETRIES = '2';
process.env.GEMINI_TIMEOUT_MS = '15000';

const { getHealthGuidance } = await import('../src/services/gemini.service.js');
const originalFetch = globalThis.fetch;
const success = (reply = 'আপনার পর্যাপ্ত বিশ্রাম নেওয়া উচিত।') => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ reply, sp: 'General', em: false }) }] } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('uses current configured model and preserves Bangla chat context', async () => {
  let requestUrl = '';
  let requestBody;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestBody = JSON.parse(options.body);
    return success();
  };

  const result = await getHealthGuidance([
    { role: 'assistant', content: 'আগের উত্তর' },
    { role: 'user', content: 'আমার মাথা ব্যথা করছে' },
    { role: 'user', content: 'আজ সকাল থেকে' },
  ]);

  assert.match(requestUrl, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(requestBody.contents[0].role, 'user');
  assert.match(requestBody.contents[0].parts[0].text, /মাথা ব্যথা/);
  assert.match(requestBody.contents[0].parts[0].text, /আজ সকাল/);
  assert.equal(result.reply, 'আপনার পর্যাপ্ত বিশ্রাম নেওয়া উচিত।');
});

test('retries a transient Gemini 503 and succeeds', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return attempts === 1
      ? new Response(JSON.stringify({ error: { message: 'temporary unavailable' } }), { status: 503 })
      : success('পানি পান করুন।');
  };
  const result = await getHealthGuidance([{ role: 'user', content: 'জ্বর হয়েছে' }]);
  assert.equal(attempts, 2);
  assert.equal(result.reply, 'পানি পান করুন।');
});

test('does not retry non-transient provider errors', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response('{}', { status: 400 });
  };
  await assert.rejects(getHealthGuidance([{ role: 'user', content: 'hello' }]), (error) => {
    assert.equal(error.status, 502);
    return true;
  });
  assert.equal(attempts, 1);
});

test('returns a gateway timeout when the upstream request times out', async () => {
  const timeout = new Error('request timed out');
  timeout.name = 'TimeoutError';
  globalThis.fetch = async () => { throw timeout; };
  await assert.rejects(getHealthGuidance([{ role: 'user', content: 'hello' }]), (error) => {
    assert.equal(error.status, 504);
    return true;
  });
});
