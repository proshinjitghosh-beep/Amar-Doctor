
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

export async function getHealthGuidance(messages) {
  if (!env.geminiApiKey) {
    throw new HttpError(503, 'Gemini API key is not configured.');
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;

  const contents = messages.slice(-12).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(message.content || '') }],
  }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      'Gemini request failed:',
      response.status,
      payload?.error?.message || 'Unknown provider error'
    );
    throw new HttpError(502, 'Gemini AI request failed. Please try again later.');
  }

  const content = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!content) {
    throw new HttpError(502, 'Gemini returned an empty response.');
  }

  let parsed;

  try {
    parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch {
    throw new HttpError(502, 'Gemini returned an invalid response format.');
  }

  const allowedSpecialists = [
    'General',
    'Cardiologist',
    'Dermatologist',
    'Pediatrician',
    'Gynecologist',
    'Neurologist',
    'Psychiatrist',
    'Orthopedic',
  ];

  return {
    reply: String(parsed.reply || 'দুঃখিত, উত্তর তৈরি করা যায়নি।'),
    sp: allowedSpecialists.includes(parsed.sp) ? parsed.sp : null,
    em: parsed.em === true,
  };
}
