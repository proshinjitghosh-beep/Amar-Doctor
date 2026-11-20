import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
process.env.GROQ_MAX_RETRIES = '2';

const { stubFetch, jsonResponse } = await import('./helpers/test-app.js');
const { completeText, completeJson, getHealthGuidance, parseJsonContent, ALLOWED_SPECIALISTS } = await import(
  '../src/services/groq.service.js'
);

/** A Groq chat-completion response with the given content. */
function completion(content) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

test('the request uses the configured model, the API key and JSON mode', async () => {
  const stub = stubFetch(async () => completion('{"reply":"হ্যালো","sp":null,"em":false}'));
  try {
    await completeText({ system: 'You are helpful.', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(stub.calls.length, 1);

    const request = stub.calls[0].options;
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, 'openai/gpt-oss-120b');
    assert.equal(request.headers.Authorization, 'Bearer test-groq-key');
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    assert.ok(payload.max_completion_tokens > 0);
    // The key must never be placed in the body.
    assert.equal(request.body.includes('test-groq-key'), false);
  } finally {
    stub.restore();
  }
});

test('the JSON hint is added only when the prompt does not mention JSON', async () => {
  const stub = stubFetch(async () => completion('{}'));
  try {
    await completeText({ system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }] });
    const system = JSON.parse(stub.calls[0].options.body).messages[0].content;
    assert.match(system, /JSON/);
  } finally {
    stub.restore();
  }
});

test('parseJsonContent strips a Markdown code fence', () => {
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonContent('{"a":1}'), { a: 1 });
});

test('a transient 503 is retried and then succeeds', async () => {
  let attempt = 0;
  const stub = stubFetch(async () => {
    attempt += 1;
    if (attempt === 1) return jsonResponse({ error: { message: 'overloaded' } }, { status: 503 });
    return completion('{"reply":"ঠিক আছে"}');
  });
  try {
    const result = await completeText({ system: 'Reply in JSON.', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result, '{"reply":"ঠিক আছে"}');
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('a 400 is not retried', async () => {
  const stub = stubFetch(async () => jsonResponse({ error: { message: 'bad request' } }, { status: 400 }));
  try {
    await assert.rejects(
      () => completeText({ system: 'Reply in JSON.', messages: [{ role: 'user', content: 'hi' }] }),
      (error) => error.status === 502
    );
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('the retries are bounded by GROQ_MAX_RETRIES', async () => {
  const stub = stubFetch(async () => jsonResponse({ error: { message: 'overloaded' } }, { status: 503 }));
  try {
    await assert.rejects(() =>
      completeText({ system: 'Reply in JSON.', messages: [{ role: 'user', content: 'hi' }] })
    );
    // GROQ_MAX_RETRIES=2 means one initial attempt plus two retries.
    assert.equal(stub.calls.length, 3);
  } finally {
    stub.restore();
  }
});

test('a network failure surfaces as a 502 and never as a fabricated answer', async () => {
  const stub = stubFetch(async () => {
    throw new TypeError('fetch failed');
  });
  try {
    await assert.rejects(
      () => completeText({ system: 'Reply in JSON.', messages: [{ role: 'user', content: 'hi' }] }),
      (error) => error.status === 502
    );
  } finally {
    stub.restore();
  }
});

test('completeJson rejects invalid JSON instead of returning partial data', async () => {
  const stub = stubFetch(async () => completion('this is not json'));
  try {
    await assert.rejects(
      () => completeJson({ system: 'Reply in JSON.', messages: [{ role: 'user', content: 'hi' }] }),
      (error) => error.status === 502
    );
  } finally {
    stub.restore();
  }
});

test('getHealthGuidance keeps the {reply, sp, em} contract', async () => {
  const stub = stubFetch(async () => completion(JSON.stringify({ reply: 'আপনার জ্বর কমানোর জন্য...', sp: 'General', em: false })));
  try {
    const result = await getHealthGuidance([{ role: 'user', content: 'জ্বর হয়েছে' }]);
    assert.equal(result.reply, 'আপনার জ্বর কমানোর জন্য...');
    assert.equal(result.sp, 'General');
    assert.equal(result.em, false);
  } finally {
    stub.restore();
  }
});

test('a specialist outside the allowlist becomes null', async () => {
  const stub = stubFetch(async () => completion(JSON.stringify({ reply: 'উত্তর', sp: 'Astrologer', em: false })));
  try {
    const result = await getHealthGuidance([{ role: 'user', content: 'hi' }]);
    assert.equal(result.sp, null);
  } finally {
    stub.restore();
  }
});

test('the emergency flag is normalised to a boolean', async () => {
  const stub = stubFetch(async () => completion(JSON.stringify({ reply: 'এক্ষুন্তই ৯৯৯ কল করুন', sp: null, em: 'true' })));
  try {
    const result = await getHealthGuidance([{ role: 'user', content: 'শ্বাসকষ্ট' }]);
    assert.equal(result.em, false, 'only a literal boolean true counts as an emergency');
  } finally {
    stub.restore();
  }
});

test('the allowlist contains only real specialist names', () => {
  assert.ok(ALLOWED_SPECIALISTS.includes('Cardiologist'));
  assert.equal(ALLOWED_SPECIALISTS.includes('Astrologer'), false);
});
