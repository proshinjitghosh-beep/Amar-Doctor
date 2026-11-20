import { z } from 'zod';
import * as repo from '../repositories/doctor-prep.repository.js';
import {
  collectContext,
  followUpQuestions,
  generateSummary,
  normaliseAnswers,
  normaliseExtraSymptoms,
  saveEditedSummary,
  summaryToText,
} from '../services/doctor-prep.service.js';
import { assertOwner } from '../middleware/ownership-check.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';

const createSchema = z.object({
  appointmentId: z.coerce.number().int().positive().optional().nullable(),
  language: z.enum(['bn', 'en']).optional(),
  answers: z.record(z.string(), z.any()).optional(),
  extraSymptoms: z.array(z.any()).optional(),
  // The patient may decline to answer the follow-up questions. Without this
  // flag an empty answer set would send the questions round again.
  skip: z.boolean().optional(),
  // A general preparation is not tied to one appointment. It matters because
  // the appointment list is sorted newest-first, so an omitted appointment
  // would otherwise silently attach the most recent - often a past - visit.
  general: z.boolean().optional(),
});

/**
 * Build a consultation summary.
 *
 * When the AI is unavailable the patient can still create the summary by
 * hand - the AI is never a dependency.
 */
export async function createSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'সারাংশের তথ্য সঠিক নয়।');
    }

    const language = parsed.data.language === 'en' ? 'en' : 'bn';
    const answers = normaliseAnswers(parsed.data.answers || {});
    const extraSymptoms = normaliseExtraSymptoms(parsed.data.extraSymptoms || []);
    const isGeneral = parsed.data.general === true;

    const context = await collectContext(userId, {
      appointmentId: isGeneral ? null : parsed.data.appointmentId ?? null,
      extraSymptoms,
      general: isGeneral,
    });

    const questions = followUpQuestions(context);
    // `skip` means the patient chose not to answer; that is a decision, so
    // the summary is built rather than the questions asked again.
    const hasAnswers = Object.keys(answers).length > 0 || parsed.data.skip === true;

    // First pass returns the questions the patient still needs to answer.
    if (!hasAnswers && questions.length) {
      return res.json({
        stage: 'questions',
        questions,
        context: {
          appointment: context.appointment,
          general: isGeneral,
          symptomCount: context.symptoms.length,
          medicationCount: context.medications.length,
          reportCount: context.reports.length,
        },
      });
    }

    let summary;
    try {
      summary = await generateSummary({ context, language, answers });
    } catch (error) {
      // The AI failed - fall back to a manual summary built from the records.
      summary = buildManualSummary(context, language, answers, extraSymptoms);
      const stored = await repo.insertVisitSummary(userId, {
        appointmentId: context.appointment?.id ?? null,
        summary,
        summaryText: summaryToText(summary, { appointment: context.appointment, language }),
        status: 'draft',
      });
      return res.status(201).json({
        stage: 'manual',
        summaryId: stored.id,
        summary: stored.summary,
        notice: 'AI বিশ্লেষণ এখন উপলব্ধ নেই। আপনার রেকর্ড থেকে সারাংশটি তৈরি করা হয়েছে — নিজে সম্পাদনা করে নিন।',
      });
    }

    const stored = await repo.insertVisitSummary(userId, {
      appointmentId: context.appointment?.id ?? null,
      summary,
      summaryText: summaryToText(summary, { appointment: context.appointment, language }),
      status: 'draft',
    });

    await recordAudit({ userId, action: 'doctor_prep.create', resourceType: 'visit_summary', resourceId: stored.id });

    return res.status(201).json({
      stage: 'ready',
      summaryId: stored.id,
      summary: stored.summary,
      summaryText: stored.summaryText,
      questions,
    });
  } catch (error) {
    return next(error);
  }
}

const SEVERITY_LABELS = {
  bn: { mild: 'হালকা', moderate: 'মাঝারি', severe: 'তীব্র' },
  en: { mild: 'mild', moderate: 'moderate', severe: 'severe' },
};

/**
 * Render a calendar date in the reader's language.
 *
 * Three shapes reach this function: a Date (the database hands timestamps
 * back as Date instances), a bare `YYYY-MM-DD`, and a full ISO timestamp.
 * All three are calendar dates, so they are formatted in UTC to keep the day
 * from shifting with the server's timezone.
 */
function formatDate(value, isBn) {
  if (value === null || value === undefined || value === '') return value;

  let date;
  if (value instanceof Date) {
    date = value;
  } else {
    const raw = String(value);
    if (raw.length !== 10 || raw[4] !== '-' || raw[7] !== '-') {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return value;
      date = parsed;
    } else {
      date = new Date(`${raw}T00:00:00Z`);
    }
  }

  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(isBn ? 'bn-BD' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return value;
  }
}

/**
 * Build a summary straight from the records when the AI is unavailable.
 *
 * `extraSymptoms` are the symptoms the patient typed into the page just now.
 * They are the patient's own account of why they came, so they are used for
 * the main complaint - but they are never turned into a diagnosis.
 */
function buildManualSummary(context, language, answers, extraSymptoms = []) {
  const isBn = language !== 'en';
  const list = (items) => (items || []).filter(Boolean);
  const severityLabels = SEVERITY_LABELS[isBn ? 'bn' : 'en'];

  // The complaint is what the patient said first: their own answer to the
  // follow-up question, or the symptom they recorded on the page. When the
  // patient has recorded symptoms, the first one is their own account of why
  // they came - so it is used rather than leaving the complaint blank.
  const complaint =
    answers.main_symptom ||
    extraSymptoms.map((s) => s.description || s.name).find(Boolean) ||
    context.symptoms.map((s) => s.name).find(Boolean) ||
    null;

  const symptomLines = list([
    ...context.symptoms.map(
      (s) => `${s.name}${s.severity ? ` (${severityLabels[s.severity] || s.severity})` : ''}`
    ),
    answers.main_symptom,
  ]);

  // The timeline comes from the patient's own dates and frequencies - both
  // the ones recorded on the page and the ones given in the follow-up answers.
  const startedLines = list([
    ...context.symptoms
      .filter((s) => s.startedAt)
      .map((s) =>
        isBn ? `শুরু: ${formatDate(s.startedAt, true)}` : `Started: ${formatDate(s.startedAt, false)}`
      ),
    ...extraSymptoms
      .filter((s) => s.startedAt)
      .map((s) =>
        isBn ? `শুরু: ${formatDate(s.startedAt, true)}` : `Started: ${formatDate(s.startedAt, false)}`
      ),
    answers.symptom_start
      ? (isBn ? `শুরু: ${formatDate(answers.symptom_start, true)}` : `Started: ${formatDate(answers.symptom_start, false)}`)
      : null,
  ]);

  const frequencyLines = list([
    ...context.symptoms
      .filter((s) => s.frequency)
      .map((s) => (isBn ? `ধারা: ${s.frequency}` : `Frequency: ${s.frequency}`)),
    ...extraSymptoms
      .filter((s) => s.frequency)
      .map((s) => (isBn ? `ধারা: ${s.frequency}` : `Frequency: ${s.frequency}`)),
    answers.symptom_frequency ? (isBn ? `ধারা: ${answers.symptom_frequency}` : `Frequency: ${answers.symptom_frequency}`) : null,
  ]);

  const timeline = list([...startedLines, ...frequencyLines]);

  return {
    language,
    appointment_context: context.appointment,
    // Attached by the server. The AI never saw the patient's name.
    patient_context: context.patientContext || null,
    main_complaint:
      complaint ||
      // The patient never said why they came. Saying so is honest; inventing
      // a reason for the visit is not.
      (isBn ? 'রোগীর নিজের বক্তব্য প্রয়োজন।' : 'The patient’s own account is needed.'),
    symptoms: symptomLines,
    symptom_timeline: timeline,
    medical_history: list([
      ...context.profile.medicalConditions.map((c) => (isBn ? `রোগ: ${c}` : `Condition: ${c}`)),
    ]),
    relevant_reports: list(
      context.reports.flatMap((report) =>
        report.results.map(
          (result) =>
            `${report.reportName}: ${result.testName} ${result.resultValue}${result.unit ? ` ${result.unit}` : ''}` +
            `${result.referenceRange ? (isBn ? ` (রেঞ্জ ${result.referenceRange})` : ` (reference range ${result.referenceRange})`) : ''}`
        )
      )
    ),
    current_medications: list(
      context.medications.map(
        (m) => `${m.label || m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.instructions ? ` — ${m.instructions}` : ''}`
      )
    ),
    allergies: list([...context.profile.allergies, answers.allergies]),
    previous_treatments: [],
    patient_questions: list([answers.patient_questions]),
    missing_information: list([
      ...(complaint
        ? []
        : [
            isBn
              ? 'রোগী কেন এসেছেন তা রোগীর নিজের বক্তব্য প্রয়োজন — বর্তমানে জানা যায়নি।'
              : 'Why the patient is seeking care is not yet recorded — the patient’s own account is needed.',
          ]),
      isBn
        ? 'কিছু তথ্য AI দ্বারা যাচাই করা যায়নি; রোগীর নিজের বক্তব্য অনুযায়ী পূরণ করা হয়েছে।'
        : 'Some details could not be verified by AI; they are filled in from the patient’s own account.',
    ]),
    limitations: list([
      isBn
        ? 'এই সারাংশ স্বয়ংক্রিয়ভাবে তৈরি — চিকিৎসকের রোগ নির্ণয়ের বিকল্প নয়।'
        : 'This summary was generated automatically and is not a diagnosis.',
    ]),
    provenance: context.provenance,
  };
}

export async function getSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const summary = await repo.findVisitSummary(req.params.id, userId);
    assertOwner(summary, userId, 'সারাংশ');
    const shareLinks = await repo.listShareLinks(userId, summary.id);
    return res.json({ summary, shareLinks });
  } catch (error) {
    return next(error);
  }
}

export async function listSummaries(req, res, next) {
  try {
    const summaries = await repo.listVisitSummaries(req.user.id, { limit: req.query?.limit });
    const appointments = await repo.listPatientAppointments(req.user.id, 20);
    return res.json({ summaries, appointments });
  } catch (error) {
    return next(error);
  }
}

/**
 * The editable shape of a summary.
 *
 * This used to be `z.any()`, which accepted a bare string: the server stored
 * it, answered 200 OK, and the doctor's PDF came out blank. The shape is
 * checked now so a malformed edit is rejected instead of silently producing
 * an empty summary.
 */
const editableSummarySchema = z
  .object({
    main_complaint: z.string().max(500).optional(),
    symptoms: z.array(z.string().max(300)).max(30).optional(),
    symptom_timeline: z.array(z.string().max(300)).max(20).optional(),
    medical_history: z.array(z.string().max(300)).max(30).optional(),
    relevant_reports: z.array(z.string().max(400)).max(30).optional(),
    current_medications: z.array(z.string().max(300)).max(30).optional(),
    allergies: z.array(z.string().max(200)).max(20).optional(),
    previous_treatments: z.array(z.string().max(300)).max(20).optional(),
    patient_questions: z.array(z.string().max(300)).max(20).optional(),
    missing_information: z.array(z.string().max(300)).max(20).optional(),
    limitations: z.array(z.string().max(300)).max(20).optional(),
    language: z.enum(['bn', 'en']).optional(),
  })
  .passthrough();

const editSchema = z.object({
  summary: editableSummarySchema.optional(),
  summaryText: z.string().max(20000).optional(),
  status: z.enum(['draft', 'patient_confirmed', 'clinician_confirmed']).optional(),
});

/** The patient edits the generated summary before approving it. */
export async function updateSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findVisitSummary(req.params.id, userId);
    assertOwner(existing, userId, 'সারাংশ');

    const parsed = editSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new HttpError(400, 'সারাংশের তথ্য সঠিক নয়।');
    }

    const updated = await saveEditedSummary(userId, existing.id, {
      summary: parsed.data.summary,
      summaryText: parsed.data.summaryText,
      status: parsed.data.status,
    });

    await recordAudit({ userId, action: 'doctor_prep.update', resourceType: 'visit_summary', resourceId: existing.id });
    return res.json({ summary: updated });
  } catch (error) {
    return next(error);
  }
}

/** Approve the summary so it can be shared. */
export async function approveSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findVisitSummary(req.params.id, userId);
    assertOwner(existing, userId, 'সারাংশ');
    const updated = await saveEditedSummary(userId, existing.id, { status: 'patient_confirmed' });
    await recordAudit({ userId, action: 'doctor_prep.approve', resourceType: 'visit_summary', resourceId: existing.id });
    return res.json({ summary: updated });
  } catch (error) {
    return next(error);
  }
}

/** Regenerate the summary from the current records. */
export async function regenerateSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const existing = await repo.findVisitSummary(req.params.id, userId);
    assertOwner(existing, userId, 'সারাংশ');

    const language = req.body?.language === 'en' ? 'en' : 'bn';
    const context = await collectContext(userId, { appointmentId: existing.appointmentId });

    let summary;
    let stage = 'ready';
    let notice;
    try {
      summary = await generateSummary({ context, language });
    } catch (error) {
      // The AI is unavailable. Creating a summary falls back to the records,
      // so regenerating one must do the same rather than dead-ending the
      // patient with a 503 and a stale summary.
      summary = buildManualSummary(context, language, {});
      stage = 'manual';
      notice = 'AI বিশ্লেষণ এখন উপলব্ধ নেই। আপনার রেকর্ড থেকে সারাংশটি আবার তৈরি করা হয়েছে — নিজে সম্পাদনা করে নিন।';
    }

    const updated = await saveEditedSummary(userId, existing.id, {
      summary,
      summaryText: summaryToText(summary, { appointment: context.appointment, language }),
      status: 'draft',
    });

    return res.json({ summary: updated, stage, notice });
  } catch (error) {
    return next(error);
  }
}

/**
 * Print-optimised HTML export.
 *
 * The browser renders this and the user saves it as a PDF, so Bengali
 * conjuncts shape correctly using the real Hind Siliguri font.
 */
export async function exportSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const summary = await repo.findVisitSummary(req.params.id, userId);
    assertOwner(summary, userId, 'সারাংশ');

    const appointment = summary.appointmentId
      ? await repo.findAppointmentById(summary.appointmentId, userId)
      : null;

    const language = req.query?.language === 'en' ? 'en' : 'bn';
    const text = summary.summaryText || summaryToText(summary.summary || {}, { appointment, language });

    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const html = `<!DOCTYPE html>
<html lang="${language === 'en' ? 'en' : 'bn'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${language === 'en' ? 'Consultation summary' : 'কনসাল্টেশন সারাংশ'}</title>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#1d1416; --mu:#6f5f62; --r:#c8102e; --ln:#ecdcd8; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px; background:#fff; color:var(--ink);
         font:15px/1.7 'Hind Siliguri',system-ui,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; }
  header { border-bottom:2px solid var(--r); padding-bottom:14px; margin-bottom:20px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:20px; }
  .brand i { width:30px; height:30px; border-radius:9px; background:var(--r); color:#fff;
             display:grid; place-items:center; font-style:normal; }
  .meta { color:var(--mu); font-size:13px; margin-top:8px; }
  h1 { font-size:22px; margin:0 0 4px; }
  pre { white-space:pre-wrap; font:inherit; margin:0; }
  .note { margin-top:26px; padding-top:14px; border-top:1px solid var(--ln);
          color:var(--mu); font-size:13px; }
  @media print {
    body { padding:0; }
    .no-print { display:none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand"><i>&#10010;</i> আমার ডাক্তার</div>
    <div class="meta">${language === 'en' ? 'Consultation summary' : 'কনসাল্টেশন সারাংশ'} · ${escapeHtml(new Date().toLocaleString(language === 'en' ? 'en-GB' : 'bn-BD'))}</div>
  </header>
  <h1>${language === 'en' ? 'Consultation summary' : 'ডাক্তারের জন্য প্রস্তুত সারাংশ'}</h1>
  <pre>${escapeHtml(text)}</pre>
  <div class="note">
    ${language === 'en'
      ? 'Generated by Amar Doctor. This is general information and is not a diagnosis or a substitute for professional medical care.'
      : 'আমার ডাক্তার দ্বারা তৈরি। এটি সাধারণ তথ্য, রোগ নির্ণয় বা চিকিৎসার বিকল্প নয়।'}
  </div>
</div>
</body>
</html>`;

    await recordAudit({ userId, action: 'doctor_prep.export', resourceType: 'visit_summary', resourceId: summary.id });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(html);
  } catch (error) {
    return next(error);
  }
}

/** Create a revocable sharing link. */
export async function shareSummary(req, res, next) {
  try {
    const userId = req.user.id;
    const summary = await repo.findVisitSummary(req.params.id, userId);
    assertOwner(summary, userId, 'সারাংশ');

    if (summary.status === 'draft') {
      throw new HttpError(400, 'শেয়ার করার আগে সারাংশটি অনুমোদন করুন।');
    }

    const recipientName = req.body?.recipientName ? String(req.body.recipientName).slice(0, 160) : null;
    const expiresInDays = Math.min(90, Math.max(1, Number(req.body?.expiresInDays) || 14));
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const link = await repo.createShareLink(userId, summary.id, { recipientName, expiresAt });

    await recordAudit({ userId, action: 'doctor_prep.share', resourceType: 'visit_summary', resourceId: summary.id });

    return res.status(201).json({
      link: {
        ...link,
        url: `/shared.html?t=${encodeURIComponent(link.token)}`,
      },
      shareLinks: await repo.listShareLinks(userId, summary.id),
    });
  } catch (error) {
    return next(error);
  }
}

export async function revokeShare(req, res, next) {
  try {
    const userId = req.user.id;
    const revoked = await repo.revokeShareLink(req.params.id, userId);
    if (!revoked) {
      throw new HttpError(404, 'শেয়ার লিংক পাওয়া যায়নি বা আগেই বাতিল করা হয়েছে।');
    }
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

/** Read a shared summary with its token. This is intentionally unauthenticated. */
export async function viewShared(req, res, next) {
  try {
    // The share link uses `?t=`; `token` is accepted as well so a copied
    // API call works either way.
    const token = String(req.query?.t || req.query?.token || '').trim();
    if (!token) {
      throw new HttpError(400, 'লিংকটি সঠিক নয়।');
    }
    const shared = await repo.findSharedSummary(token);
    if (!shared) {
      throw new HttpError(404, 'লিংকটি পাওয়া যায়নি।');
    }
    if (shared.revoked) {
      throw new HttpError(410, 'এই লিংকটি বাতিল করা হয়েছে।');
    }
    if (shared.expired) {
      throw new HttpError(410, 'এই লিংকটির মেয়াদ শেষ হয়েছে।');
    }
    return res.json({ summary: shared.summary, summaryText: shared.summaryText, createdAt: shared.createdAt });
  } catch (error) {
    return next(error);
  }
}
