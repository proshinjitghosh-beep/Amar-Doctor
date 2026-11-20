import { z } from 'zod';
import { generateStructured } from './ai.service.js';

/**
 * Schema for the AI's explanation of a report.
 *
 * The AI explains the rows we extracted; it never supplies the values. The
 * schema therefore has no field for a value, a unit, a reference range or a
 * status - those come from the document itself and from our own comparison.
 */
const analysisSchema = z.object({
  report_type: z.string().max(80).optional(),
  summary: z.string().max(2000),
  results: z
    .array(
      z.object({
        test_name: z.string().min(1).max(120),
        explanation: z.string().max(1200),
        requires_review: z.boolean(),
      })
    )
    .max(120),
  important_observations: z.array(z.string().max(400)).max(10).default([]),
  questions_for_doctor: z.array(z.string().max(400)).max(10).default([]),
  limitations: z.array(z.string().max(400)).max(10).default([]),
});

const ANALYSIS_SYSTEM_PROMPT = `You explain medical laboratory reports to patients in Bangladesh.

You receive a list of test results taken from the patient's report. Each result carries:
- test_name: the name printed on the report
- result_value: the value printed on the report
- unit: the unit printed on the report
- reference_range: the reference range printed on the report (may be null)
- status: a comparison against that printed range (normal, below_reference, above_reference, critical_high, critical_low, unknown)
- source: either "extracted" - read out of the document by the app - or "manual" - the patient typed the value in by hand because the document could not be read

Rules:
- Explain each test in general, plain language: what it measures and what the printed value suggests.
- Use the printed reference range. If reference_range is null, say that the report did not print a range and that a clinician must interpret the value - never supply a range of your own.
- A result whose source is "manual" was NOT read from the document - the patient entered it. Say so plainly, and treat the value as the patient's own record of what the report said. Never claim to have read it from the document.
- Do not change, upgrade or downgrade the status. Do not include a status in your answer.
- Do not diagnose. Do not name a disease. Do not recommend a medicine, antibiotic, or dosage.
- Do not suggest treatment. You may say which results a doctor should review.
- When a result's requires_review is true, say plainly that the value needs to be confirmed.
- Mention missing information in "limitations" (for example a missing reference range or an unreadable value).
- Suggest questions the patient could ask their doctor.

Write in the requested language.`;

function buildPrompt({ rows, language, reportType }) {
  const readable = rows
    .map(
      (row) =>
        `- ${row.testName}: ${row.resultValue}${row.unit ? ` ${row.unit}` : ''}` +
        `${row.referenceRange ? ` (printed reference range: ${row.referenceRange})` : ' (no reference range printed on the report)'}` +
        ` [status: ${row.status}${row.requiresReview ? ', requires confirmation' : ''}` +
        `${row.source === 'manual' ? ', entered by the patient by hand, not read from the document' : ''}]`
    )
    .join('\n');

  const languageInstruction =
    language === 'en'
      ? 'Write the entire answer in English.'
      : 'Write the entire answer in Bangla (বাংলা), keeping the medical test names in English where that is clearer.';

  return `Report type detected from the document: ${reportType || 'Unknown'}

Test results read from the report:
${readable || '- No test values could be read from this document.'}

${languageInstruction}

Return a JSON object with: report_type, summary, results, important_observations, questions_for_doctor, limitations.
The "results" array must contain one entry for each test result above, using the same test_name, with the keys test_name, explanation and requires_review.`;
}

/**
 * Ask the AI to explain the extracted results.
 *
 * The rows passed in are the only source of truth. The returned explanations
 * are matched back onto those rows, so an explanation for a test that is not
 * in the document is discarded.
 */
export async function analyzeReport({ rows, language = 'bn', reportType = null }) {
  if (!rows.length) {
    return {
      report_type: reportType || 'Unknown',
      summary: 'এই রিপোর্ট থেকে কোনো টেস্টের মান পড়া যায়নি। রিপোর্টের ছবিটি আরও স্পষ্ট হলে ভালো হবে, অথবা আপনি নিজে মানগুলো লিখে দিতে পারেন।',
      results: [],
      important_observations: [],
      questions_for_doctor: [],
      limitations: ['রিপোর্টের লেখা স্পষ্টভাবে পড়া যায়নি।'],
    };
  }

  const analysis = await generateStructured({
    system: ANALYSIS_SYSTEM_PROMPT,
    prompt: buildPrompt({ rows, language, reportType }),
    schema: analysisSchema,
    maxTokens: 3000,
    temperature: 0.2,
  });

  // Keep only explanations for tests that were actually read from the report.
  const byName = new Map(rows.map((row) => [row.testName.toLowerCase(), row]));
  const keptResults = (analysis.results || [])
    .map((entry) => {
      const source = byName.get(String(entry.test_name || '').toLowerCase());
      if (!source) return null;
      return {
        testName: source.testName,
        status: source.status,
        explanation: entry.explanation,
        requiresReview: source.requiresReview || entry.requires_review === true,
        interpretation: entry.explanation,
        verificationStatus: 'extracted',
      };
    })
    .filter(Boolean);

  return {
    report_type: analysis.report_type || reportType || 'Unknown',
    summary: analysis.summary,
    results: keptResults,
    important_observations: analysis.important_observations || [],
    questions_for_doctor: analysis.questions_for_doctor || [],
    limitations: analysis.limitations || [],
  };
}

/**
 * Answer a question about a specific report.
 *
 * The model is given only the stored rows for that report. If the question
 * cannot be answered from those rows, it must say so.
 */
export async function answerQuestionAboutReport({ rows, question, language = 'bn' }) {
  const readable = rows
    .map(
      (row) =>
        `- ${row.testName}: ${row.resultValue}${row.unit ? ` ${row.unit}` : ''}` +
        `${row.referenceRange ? ` (printed reference range: ${row.referenceRange})` : ' (no reference range printed on the report)'}` +
        `${row.source === 'manual' ? ' [entered by the patient by hand, not read from the document]' : ''}`
    )
    .join('\n');

  const languageInstruction =
    language === 'en' ? 'Answer in English.' : 'উত্তর দিন বাংলায়, প্রয়োজনে ইংরেজি চিকিৎসা-পরিভাষা ব্যবহার করে।';

  const prompt = `The patient's report contains these results. Most were read directly from the document; any marked as entered by the patient by hand were not read from the document and are the patient's own record of what it said:
${readable || '- No results were extracted from this report.'}

Patient question: ${question}

${languageInstruction}

Answer using only the results above. If the answer is not in these results, say clearly that the information is not available in this report - do not guess.
Do not diagnose, prescribe, or recommend a medicine or dosage.
Keep the answer short and practical, and end with what the patient should ask their doctor if relevant.`;

  const { completeJson } = await import('./groq.service.js');
  const raw = await completeJson({
    system:
      'You answer questions about a patient\'s own laboratory report. You use only the results given to you, never outside knowledge about the person, and you never diagnose or prescribe. Return ONLY a valid JSON object with a single key "answer" containing a string.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
    temperature: 0.3,
  });

  return {
    answer: String(raw?.answer || '').trim() || 'এই রিপোর্টের তথ্য দিয়ে উত্তর দেওয়া সম্ভব হয়নি।',
    grounded: rows.length > 0,
  };
}
