
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
  if (!env.groqApiKey) {
    throw new HttpError(503, 'Groq API key is not configured.');
  }

  const groqMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.slice(-12).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || ''),
    })),
  ];

  let response;

  try {
    response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.groqApiKey}`,
        },
        body: JSON.stringify({
          model: env.groqModel,
          messages: groqMessages,
          temperature: 0.4,
          max_completion_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
  } catch (error) {
    console.error('Groq connection failed:', error.message);
    throw new HttpError(502, 'AI service is temporarily unavailable.');
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      'Groq request failed:',
      response.status,
      payload?.error?.message || 'Unknown provider error'
    );
    throw new HttpError(502, 'AI request failed. Please try again later.');
  }

  const content = payload?.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new HttpError(502, 'Groq returned an empty response.');
  }

  let parsed;

  try {
    parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch {
    throw new HttpError(502, 'Groq returned an invalid response format.');
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
