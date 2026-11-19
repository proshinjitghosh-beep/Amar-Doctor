import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const SYSTEM_PROMPT = `You are Amar Doctor, a Bangla-first health information assistant for people in Bangladesh.

You are not a physician. Never claim to diagnose or prescribe medicines, antibiotics, prescription-only drugs, or dosages.

If symptoms may indicate an emergency, clearly tell the user to call Bangladesh emergency number 999 or go to the nearest emergency department immediately.

If essential information is missing, ask at most two concise questions.

For non-emergency questions:
- Provide cautious, relevant general health information.
- Suggest safe non-drug self-care where appropriate.
- Explain warning signs that require in-person care.
- Suggest an appropriate type of licensed clinician when relevant.
- Do not recommend a specialist without a reasonable explanation.
- Do not invent certainty.

Reply in the user's language, including natural Bangla when the user writes in Bangla.

Return ONLY a valid JSON object:
{
  "reply": "Your response here",
  "sp": "General",
  "em": false
}

The sp field must be one of:
General, Cardiologist, Dermatologist, Pediatrician,
Gynecologist, Neurologist, Psychiatrist, Orthopedic,
or null.`;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const ALLOWED_SPECIALISTS = new Set([
  'General', 'Cardiologist', 'Dermatologist', 'Pediatrician',
  'Gynecologist', 'Neurologist', 'Psychiatrist', 'Orthopedic',
]);

function normalizeContents(messages) {
  const contents = [];
  for (const message of messages.slice(-12)) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const text = String(message.content || '').trim();
    if (!text) continue;
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts[0].text += `\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  }
  // Gemini conversations must begin with a user turn.
  while (contents[0]?.role === 'model') contents.shift();
  return contents;
}

function retryAfterMs(response) {
  const value = response.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(2000, Math.max(0, seconds * 1000));
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? null : Math.min(2000, Math.max(0, dateMs - Date.now()));
}

function isRetryableNetworkError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError' ||
    error instanceof TypeError || error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';
}

async function requestGemini(url, body) {
  const totalAttempts = env.geminiMaxRetries + 1;
  let lastError;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.geminiApiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.geminiTimeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt === totalAttempts) break;
      await delay(Math.min(1200, 250 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 150)));
      continue;
    }

    if (response.ok) return response;
    const retryable = RETRYABLE_STATUS.has(response.status);
    if (!retryable || attempt === totalAttempts) {
      // Do not log or return provider response bodies, which may contain sensitive data.
      console.error(`Gemini request failed (HTTP ${response.status}, attempt ${attempt}/${totalAttempts}).`);
      throw new HttpError(response.status === 429 ? 503 : 502,
        response.status === 429
          ? 'AI service is busy. Please try again shortly.'
          : 'Gemini AI request failed. Please try again later.');
    }

    const waitMs = retryAfterMs(response) ??
      Math.min(1200, 250 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 150));
    await response.body?.cancel().catch(() => {});
    await delay(waitMs);
  }

  const timedOut = lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError';
  console.error(`Gemini request ${timedOut ? 'timed out' : 'could not connect'} after ${totalAttempts} attempt(s).`);
  throw new HttpError(timedOut ? 504 : 502,
    timedOut
      ? 'The AI response took too long. Please try again.'
      : 'Could not connect to the AI service. Please try again later.');
}

export async function getHealthGuidance(messages) {
  if (!env.geminiApiKey) {
    throw new HttpError(503, 'Gemini API key is not configured.');
  }

  const contents = normalizeContents(messages);
  if (!contents.length || !contents.some((item) => item.role === 'user')) {
    throw new HttpError(400, 'At least one user message is required.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`;
  const response = await requestGemini(url, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 900,
      responseMimeType: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  const content = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!content) {
    console.error('Gemini returned no candidate text.');
    throw new HttpError(502, 'Gemini returned an empty response. Please try again.');
  }

  let parsed;
  try {
    parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch {
    console.error('Gemini returned invalid JSON.');
    throw new HttpError(502, 'Gemini returned an invalid response. Please try again.');
  }

  return {
    reply: typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : 'দুঃখিত, উত্তর তৈরি করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
    sp: ALLOWED_SPECIALISTS.has(parsed.sp) ? parsed.sp : null,
    em: parsed.em === true,
  };
}
