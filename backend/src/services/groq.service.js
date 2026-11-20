
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']);

/** Groq's JSON mode requires the literal token "JSON" somewhere in the prompt. */
const JSON_HINT = 'Return ONLY a valid JSON object.';

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

Reply in the user's language.

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

const ALLOWED_SPECIALISTS = [
  'General',
  'Cardiologist',
  'Dermatologist',
  'Pediatrician',
  'Gynecologist',
  'Neurologist',
  'Psychiatrist',
  'Orthopedic',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(2000, seconds * 1000);
    }
  }
  return Math.min(2000, 300 * 2 ** attempt + Math.floor(Math.random() * 200));
}

function isRetryableError(error) {
  return (
    error?.name === 'AbortError' ||
    error?.name === 'TimeoutError' ||
    RETRYABLE_ERROR_CODES.has(error?.code) ||
    error instanceof TypeError
  );
}

/**
 * Strip a Markdown code fence from a JSON payload. Groq occasionally wraps
 * JSON even when `response_format` is set.
 */
export function parseJsonContent(content) {
  const cleaned = String(content || '').replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Single low-level call to the Groq chat-completions endpoint.
 *
 * `messages` is the already-built message array. `temperature` and
 * `maxTokens` are clamped to protect both the budget and the response size.
 */
async function callGroq({ messages, temperature = 0.4, maxTokens = 1200, model, signal }) {
  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.groqApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: signal ?? AbortSignal.timeout(env.groqTimeoutMs),
    });
  } catch (error) {
    // The error message can contain a URL but never patient content.
    console.error('Groq connection failed:', error.message);
    throw new HttpError(502, 'AI সেবা সাময়িকভাবে উপলব্ধ নেই।');
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      'Groq request failed:',
      response.status,
      payload?.error?.message || 'Unknown provider error'
    );
    // The client always sees a 502: a provider failure is our problem, not
    // the caller's bad request. The provider's own status is kept on a
    // separate field so the retry logic can decide what to do with it.
    const error = new HttpError(502, 'AI সেবায় অনুরোধ ব্যর্থ হয়েছে। একটু পরে আবার চেষ্টা করুন।');
    error.retryable = RETRYABLE_STATUSES.has(response.status);
    error.retryAfter = response.headers?.get?.('retry-after') || null;
    error.providerStatus = response.status;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new HttpError(502, 'AI সেবা থেকে উত্তর পাওয়া যায়নি।');
  }
  return content;
}

/**
 * Call Groq and return the raw text of the completion.
 *
 * Retries transient provider and network failures with jittered backoff.
 * Error logs never include the conversation.
 */
export async function completeText({ system, messages, temperature = 0.4, maxTokens = 1200, model = env.groqModel }) {
  if (!env.groqApiKey) {
    throw new HttpError(503, 'AI সেবাটি এখন কনফিগার করা নেই।');
  }

  const groqMessages = [
    {
      role: 'system',
      // Groq's JSON mode is only enabled when the prompt contains "JSON".
      content: /JSON/i.test(system) ? system : `${system}\n\n${JSON_HINT}`,
    },
    ...messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || ''),
    })),
  ];

  const attempts = env.groqMaxRetries + 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await callGroq({ messages: groqMessages, temperature, maxTokens, model });
    } catch (error) {
      lastError = error;
      const retryable = error.retryable === true || isRetryableError(error);
      if (!retryable || attempt === attempts - 1) break;
      await sleep(backoffMs(attempt, error.retryAfter));
    }
  }

  throw lastError;
}

/**
 * Call Groq and parse the response as JSON. On a JSON parse failure the
 * caller receives an HttpError - it never receives fabricated data.
 */
export async function completeJson(options) {
  const content = await completeText(options);
  try {
    return parseJsonContent(content);
  } catch {
    throw new HttpError(502, 'AI সেবার উত্তরের ফরম্যাট সঠিক ছিল না।');
  }
}

/**
 * The original chat contract: {reply, sp, em}.
 * Kept byte-for-byte compatible with the existing frontend.
 */
export async function getHealthGuidance(messages) {
  const parsed = await completeJson({
    system: SYSTEM_PROMPT,
    messages: messages.slice(-12),
    temperature: 0.4,
    maxTokens: 1200,
  });

  return {
    reply: String(parsed.reply || 'দুঃখিত, উত্তর তৈরি করা যায়নি।'),
    sp: ALLOWED_SPECIALISTS.includes(parsed.sp) ? parsed.sp : null,
    em: parsed.em === true,
  };
}

/**
 * Vision call: one image plus a text prompt, using a vision-capable model on
 * the same Groq account. Used only for OCR of report images and scanned PDFs.
 */
export async function completeVisionJson({ system, prompt, imageDataUrl, mimeType = 'image/png', maxTokens = 2000 }) {
  if (!env.groqApiKey) {
    throw new HttpError(503, 'AI সেবাটি এখন কনফিগার করা নেই।');
  }
  if (!env.groqVisionModel) {
    throw new HttpError(503, 'ছবি থেকে লেখা পড়ার ফিচারটি কনফিগার করা হয়নি।');
  }

  const messages = [
    {
      role: 'system',
      content: /JSON/i.test(system) ? system : `${system}\n\n${JSON_HINT}`,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: String(prompt || '') },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageDataUrl}` } },
      ],
    },
  ];

  const attempts = env.groqMaxRetries + 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const content = await callGroq({
        messages,
        temperature: 0,
        maxTokens,
        model: env.groqVisionModel,
      });
      return parseJsonContent(content);
    } catch (error) {
      lastError = error;
      const retryable = error.retryable === true || isRetryableError(error);
      if (!retryable || attempt === attempts - 1) break;
      await sleep(backoffMs(attempt, error.retryAfter));
    }
  }

  throw lastError;
}

export { ALLOWED_SPECIALISTS, SYSTEM_PROMPT };
