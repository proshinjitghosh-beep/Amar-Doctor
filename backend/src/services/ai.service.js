import { completeJson } from './groq.service.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Shared system rules for every AI-backed healthcare feature.
 *
 * These encode the safety requirements from docs/SAFETY.md so they cannot
 * drift between the report analyzer, the visit-prep generator and the chat.
 */
export const SAFETY_RULES = `You are a medical information assistant for Amar Doctor, a healthcare platform in Bangladesh.

Hard rules:
- You are not a physician. Never diagnose, and never prescribe medicines, antibiotics, dosages, or treatment plans.
- Never invent facts. If a value, unit, reference range, symptom, medication, or piece of history is not present in the information you were given, you must not produce it.
- If information is missing, say so explicitly in the "limitations" or "missing_information" field.
- Explain what the given numbers mean in general terms and what a clinician should review.
- Do not replace professional care. Encourage consulting a qualified doctor.
- If the information suggests a possible emergency, tell the person to call 999 or go to the nearest emergency department immediately.`;

/**
 * Ask the model for a JSON object and validate it against a zod schema.
 *
 * When the model's first response does not match the schema, one repair
 * attempt is made. If that also fails the caller receives an HttpError -
 * a malformed model response never reaches the database.
 */
export async function generateStructured({ system, prompt, schema, maxTokens = 2000, temperature = 0.2 }) {
  const fullSystem = `${SAFETY_RULES}\n\n${system}`;

  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await completeJson({
      system: attempt === 0 ? fullSystem : `${fullSystem}\n\nYour previous reply did not match the required schema. Return only the JSON object, with every required field present.`,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      maxTokens,
    });

    const result = schema.safeParse(raw);
    if (result.success) {
      return result.data;
    }

    lastError = result.error;
  }

  throw new HttpError(502, 'AI উত্তরের গঠন সঠিক ছিল না। অনুগ্রহ করে আবার চেষ্টা করুন।');
}
