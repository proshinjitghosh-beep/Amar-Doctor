import http from 'node:http';

/**
 * Start the Express app on an ephemeral port and return a small client.
 *
 * The app is imported by the caller *after* the environment has been set,
 * because `config/env.js` reads `process.env` at import time and throws in
 * production when the Groq key is missing.
 */
export async function startTestServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const baseUrl = `http://127.0.0.1:${port}`;

  /** A tiny cookie-aware client so session cookies work across requests. */
  function createClient() {
    const cookies = new Map();

    function cookieHeader() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    async function request(method, path, { body, headers = {}, raw = false } = {}) {
      const init = { method, headers: { ...headers }, redirect: 'manual' };
      const jar = cookieHeader();
      if (jar) init.headers.cookie = jar;

      if (body instanceof FormData) {
        init.body = body;
      } else if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      const response = await fetch(`${baseUrl}${path}`, init);

      for (const raw2 of response.headers.getSetCookie?.() || []) {
        const [pair] = raw2.split(';');
        const index = pair.indexOf('=');
        cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }

      if (raw) {
        return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
      }

      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, headers: response.headers, body: json, text };
    }

    return {
      get: (path, options) => request('GET', path, options),
      post: (path, body, options) => request('POST', path, { ...options, body }),
      put: (path, body, options) => request('PUT', path, { ...options, body }),
      patch: (path, body, options) => request('PATCH', path, { ...options, body }),
      delete: (path, options) => request('DELETE', path, options),
      cookies,
    };
  }

  return {
    baseUrl,
    client: createClient(),
    createClient,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Stub global fetch for the AI provider and count the calls.
 *
 * Only requests to the AI provider are intercepted - everything else (the
 * test client talking to the app under test) is passed through to the real
 * fetch, so the stub never swallows the test's own traffic.
 */
export function stubFetch(handler, { match = (url) => url.includes('groq.com') } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (!match(href)) return original(url, options);
    calls.push({ url: href, options });
    return handler(href, options, calls.length);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** A JSON HTTP response for the fetch stub. */
export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
