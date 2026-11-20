import { z } from 'zod';
import * as repo from '../repositories/doctor-prep.repository.js';
import * as reportsRepo from '../repositories/reports.repository.js';
import * as medicationsRepo from '../repositories/medications.repository.js';
import * as healthProfile from './health-profile.service.js';
import { generateStructured } from './ai.service.js';
import { cleanList, cleanMultiline, cleanText } from '../utils/medical-validation.js';
import { HttpError } from '../utils/http-error.js';

/**
 * AI doctor visit preparation.
 *
 * The summary is built from data the patient actually has in the app. Each
 * piece of information carries its provenance so a doctor can tell what the
 * patient reported from what was extracted from a document.
 */

const summarySchema = z.object({
  main_complaint: z.string().max(500),
  symptoms: z.array(z.string().max(300)).max(30).default([]),
  symptom_timeline: z.array(z.string().max(300)).max(20).default([]),
  medical_history: z.array(z.string().max(300)).max(30).default([]),
  relevant_reports: z.array(z.string().max(400)).max(30).default([]),
  current_medications: z.array(z.string().max(300)).max(30).default([]),
  allergies: z.array(z.string().max(200)).max(20).default([]),
  previous_treatments: z.array(z.string().max(300)).max(20).default([]),
  patient_questions: z.array(z.string().max(300)).max(20).default([]),
  missing_information: z.array(z.string().max(300)).max(20).default([]),
  limitations: z.array(z.string().max(300)).max(20).default([]),
});

const SUMMARY_SYSTEM_PROMPT = `You prepare a short, structured summary so a doctor can understand a patient's situation quickly before the consultation.

You receive only information that was collected from the patient's own records in the app. Use nothing else.

Rules:
- Use only the facts in the payload. If a fact is not in the payload, do not write it, and do not guess it.
- Never diagnose. Never suggest a disease name, a medicine, a dosage, or a treatment.
- Do not invent symptoms, lab values, medication details, allergies, or history.
- Organize the information the doctor needs to know. Keep every item short and factual.
- Put anything the patient has not told you under "missing_information".
- Put anything you could not verify, or that limits the summary, under "limitations".
- "main_complaint" is the reason the patient is seeking care, in one or two sentences.
- "patient_questions" holds the questions the patient wants to ask the doctor.
- "relevant_reports" describes only report results that were supplied, including the printed reference range where one exists.

Write in the requested language.`;

/** Collect the authorised health information for one appointment. */
export async function collectContext(userId, { appointmentId = null, extraSymptoms = [] } = {}) {
  const profile = await healthProfile.getOrCreateHealthProfile(userId);
  const symptoms = await healthProfile.listSymptoms(userId, 30);
  const medications = await medicationsRepo.listMedications(userId, { status: 'active' });
  const reports = await reportsRepo.listReports(userId, 30);
  const appointments = await repo.listPatientAppointments(userId, 10);
  const previousSummaries = await repo.listVisitSummaries(userId, 5);

  const appointment = appointmentId
    ? appointments.find((item) => item.id === Number(appointmentId)) || null
    : appointments[0] || null;

  // Only confirmed or patient-confirmed report results are shared with a
  // doctor. An unverified extraction is not treated as a clinical fact.
  const relevantReports = [];
  for (const report of reports.slice(0, 10)) {
    const results = await reportsRepo.listReportResults(report.id, userId);
    const usable = results.filter(
      (result) => result.verificationStatus === 'patient_confirmed' || result.verificationStatus === 'clinician_confirmed'
    );
    if (!usable.length) continue;
    relevantReports.push({
      reportId: report.id,
      reportName: report.fileName,
      reportType: report.reportType,
      createdAt: report.createdAt,
      results: usable.map((result) => ({
        testName: result.testName,
        resultValue: result.resultValue,
        unit: result.unit,
        referenceRange: result.referenceRange,
        status: result.status,
        provenance: result.verificationStatus,
      })),
    });
  }

  return {
    appointment: appointment
      ? {
          id: appointment.id,
          doctorName: appointment.doctorName,
          specialty: appointment.specialty,
          scheduledAt: appointment.scheduledAt,
        }
      : null,
    profile: {
      fullName: profile?.fullName || null,
      dateOfBirth: profile?.dateOfBirth || null,
      sex: profile?.sex || null,
      bloodGroup: profile?.bloodGroup || null,
      allergies: profile?.allergies || [],
      medicalConditions: profile?.medicalConditions || [],
    },
    symptoms: [
      ...symptoms.map((symptom) => ({
        name: symptom.symptomName,
        description: symptom.description,
        severity: symptom.severity,
        startedAt: symptom.startedAt,
        frequency: symptom.frequency,
        recordedAt: symptom.recordedAt,
        provenance: 'patient_reported',
      })),
      ...extraSymptoms.map((symptom) => ({
        name: symptom.name,
        description: symptom.description || null,
        severity: symptom.severity || 'mild',
        startedAt: symptom.startedAt || null,
        frequency: symptom.frequency || null,
        recordedAt: new Date().toISOString(),
        provenance: 'patient_reported',
      })),
    ],
    medications: medications.map((medication) => ({
      name: medication.medicineName,
      dosage: medication.dosage,
      instructions: medication.instructions,
      startDate: medication.startDate,
      provenance: medication.verificationStatus,
    })),
    reports: relevantReports,
    previousSummaries: previousSummaries
      .filter((summary) => summary.appointmentId !== appointment?.id)
      .map((summary) => ({
        createdAt: summary.createdAt,
        summaryText: summary.summaryText,
      })),
    provenance: {
      patient_reported: 'রোগীর নিজের বক্তব্য',
      extracted: 'দাগ করা রিপোর্ট থেকে নেওয়া (যাচাই করা হয়নি)',
      needs_review: 'যাচাই করা হয়নি',
      patient_confirmed: 'রোগী নিজে যাচাই করেছেন',
      clinician_confirmed: 'চিকিৎসক যাচাই করেছেন',
    },
  };
}

/**
 * The gaps the interface should ask about before generating the summary.
 * Every question can be skipped or answered "জানা নেই".
 */
export function followUpQuestions(context) {
  const questions = [];

  if (!context.symptoms.length) {
    questions.push({
      key: 'main_symptom',
      question: 'কোন সমস্যার জন্য ডাক্তার দেখাতে এসেছেন?',
      type: 'text',
    });
    questions.push({
      key: 'symptom_start',
      question: 'সমস্যাটি কবে থেকে শুরু হয়েছে?',
      type: 'date',
    });
    questions.push({
      key: 'symptom_frequency',
      question: 'সমস্যাটি কত ঘন ঘন হয়?',
      type: 'text',
    });
    questions.push({
      key: 'symptom_severity',
      question: 'কতটা তীব্র?',
      type: 'choice',
      options: ['mild', 'moderate', 'severe'],
      labels: { mild: 'হালকা', moderate: 'মাঝারি', severe: 'তীব্র' },
    });
  } else {
    const withoutStart = context.symptoms.filter((symptom) => !symptom.startedAt);
    if (withoutStart.length) {
      questions.push({
        key: 'symptom_start',
        question: 'সমস্যাটি কবে থেকে শুরু হয়েছে?',
        type: 'date',
      });
    }
  }

  if (!context.medications.length) {
    questions.push({
      key: 'current_medication',
      question: 'এখন কোনো ওষুধ খাচ্ছেন কি?',
      type: 'text',
    });
  }

  if (!context.profile.allergies.length) {
    questions.push({
      key: 'allergies',
      question: 'কোনো ওষুধে অ্যালার্জি আছে কি?',
      type: 'text',
    });
  }

  questions.push({
    key: 'patient_questions',
    question: 'ডাক্তারকে কী জিজ্ঞেস করতে চান?',
    type: 'text',
  });

  return questions;
}

function buildPrompt(context, language, answers = {}) {
  const lines = [];

  lines.push(`Patient name: ${context.profile.fullName || 'not recorded'}`);
  if (context.profile.dateOfBirth) lines.push(`Date of birth: ${context.profile.dateOfBirth}`);
  if (context.profile.sex) lines.push(`Sex: ${context.profile.sex}`);
  if (context.profile.bloodGroup) lines.push(`Blood group: ${context.profile.bloodGroup}`);

  if (context.appointment) {
    lines.push(
      `\nAppointment: ${context.appointment.doctorName} (${context.appointment.specialty}) at ${context.appointment.scheduledAt}`
    );
  }

  lines.push('\nSymptoms reported by the patient:');
  if (context.symptoms.length) {
    for (const symptom of context.symptoms) {
      lines.push(
        `- ${symptom.name}${symptom.severity ? ` (severity: ${symptom.severity})` : ''}` +
          `${symptom.startedAt ? `, started: ${symptom.startedAt}` : ''}` +
          `${symptom.frequency ? `, frequency: ${symptom.frequency}` : ''}` +
          `${symptom.description ? ` — ${symptom.description}` : ''}`
      );
    }
  } else {
    lines.push('- none recorded');
  }

  lines.push('\nKnown medical conditions:');
  lines.push(context.profile.medicalConditions.length ? context.profile.medicalConditions.map((c) => `- ${c}`).join('\n') : '- none recorded');

  lines.push('\nAllergies:');
  lines.push(context.profile.allergies.length ? context.profile.allergies.map((a) => `- ${a}`).join('\n') : '- none recorded');

  lines.push('\nCurrent medications:');
  lines.push(
    context.medications.length
      ? context.medications
          .map((m) => `- ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.instructions ? ` (${m.instructions})` : ''}`)
          .join('\n')
      : '- none recorded'
  );

  lines.push('\nConfirmed report results:');
  if (context.reports.length) {
    for (const report of context.reports) {
      lines.push(`- ${report.reportName}${report.reportType ? ` (${report.reportType})` : ''}`);
      for (const result of report.results) {
        lines.push(
          `  - ${result.testName}: ${result.resultValue}${result.unit ? ` ${result.unit}` : ''}` +
            `${result.referenceRange ? ` [printed reference range: ${result.referenceRange}]` : ' [no reference range printed]'}`
        );
      }
    }
  } else {
    lines.push('- none confirmed');
  }

  if (context.previousSummaries.length) {
    lines.push('\nPrevious consultation summaries:');
    for (const summary of context.previousSummaries) {
      lines.push(`- ${summary.createdAt}: ${summary.summaryText || '(no text)'}`);
    }
  }

  if (Object.keys(answers).length) {
    lines.push('\nAdditional information the patient gave just now:');
    for (const [key, value] of Object.entries(answers)) {
      if (value === null || value === undefined || value === '') continue;
      lines.push(`- ${key}: ${value}`);
    }
  }

  const languageInstruction =
    language === 'en'
      ? 'Write the entire summary in English.'
      : 'সারাংশটি বাংলায় লিখুন, চিকিৎসা-পরিভাষা প্রয়োজনে ইংরেজিতে রাখা যাবে।';

  return `${lines.join('\n')}

${languageInstruction}

Return a JSON object with: main_complaint, symptoms, symptom_timeline, medical_history, relevant_reports, current_medications, allergies, previous_treatments, patient_questions, missing_information, limitations.`;
}

/** Generate the structured consultation summary. */
export async function generateSummary({ context, language = 'bn', answers = {} }) {
  const analysis = await generateStructured({
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: buildPrompt(context, language, answers),
    schema: summarySchema,
    maxTokens: 3000,
    temperature: 0.2,
  });

  return {
    appointment_context: context.appointment,
    main_complaint: analysis.main_complaint,
    symptoms: analysis.symptoms,
    symptom_timeline: analysis.symptom_timeline,
    medical_history: analysis.medical_history,
    relevant_reports: analysis.relevant_reports,
    current_medications: analysis.current_medications,
    allergies: analysis.allergies,
    previous_treatments: analysis.previous_treatments,
    patient_questions: analysis.patient_questions,
    missing_information: analysis.missing_information,
    limitations: analysis.limitations,
    provenance: context.provenance,
  };
}

/** Render a summary as plain text for the printable export. */
export function summaryToText(summary, { appointment = null, language = 'bn' } = {}) {
  const isBn = language !== 'en';
  const heading = {
    main_complaint: isBn ? 'মূল সমস্যা' : 'Main complaint',
    symptoms: isBn ? 'লক্ষণ' : 'Symptoms',
    symptom_timeline: isBn ? 'লক্ষণের সময়ক্রম' : 'Symptom timeline',
    medical_history: isBn ? 'চিকিৎসা ইতিহাস' : 'Medical history',
    relevant_reports: isBn ? 'প্রাসঙ্গিক রিপোর্ট' : 'Relevant reports',
    current_medications: isBn ? 'বর্তমান ওষুধ' : 'Current medications',
    allergies: isBn ? 'অ্যালার্জি' : 'Allergies',
    previous_treatments: isBn ? 'পূর্ববর্তী চিকিৎসা' : 'Previous treatments',
    patient_questions: isBn ? 'ডাক্তারকে প্রশ্ন' : 'Questions for the doctor',
    missing_information: isBn ? 'অনুপলব্ধ তথ্য' : 'Missing information',
    limitations: isBn ? 'সীমাবদ্ধতা' : 'Limitations',
  };

  const parts = [];

  if (appointment) {
    parts.push(
      isBn
        ? `অ্যাপয়েন্টমেন্ট: ${appointment.doctorName} (${appointment.specialty}) — ${new Date(appointment.scheduledAt).toLocaleString('bn-BD')}`
        : `Appointment: ${appointment.doctorName} (${appointment.specialty}) — ${new Date(appointment.scheduledAt).toLocaleString('en-GB')}`
    );
  }

  const sections = [
    ['main_complaint', summary.main_complaint, false],
    ['symptoms', summary.symptoms, true],
    ['symptom_timeline', summary.symptom_timeline, true],
    ['medical_history', summary.medical_history, true],
    ['relevant_reports', summary.relevant_reports, true],
    ['current_medications', summary.current_medications, true],
    ['allergies', summary.allergies, true],
    ['previous_treatments', summary.previous_treatments, true],
    ['patient_questions', summary.patient_questions, true],
    ['missing_information', summary.missing_information, true],
    ['limitations', summary.limitations, true],
  ];

  for (const [key, value, isList] of sections) {
    if (isList) {
      if (!value || !value.length) continue;
      parts.push(`${heading[key]}:`);
      for (const item of value) parts.push(`  • ${item}`);
    } else {
      if (!value) continue;
      parts.push(`${heading[key]}: ${value}`);
    }
  }

  parts.push(
    isBn
      ? 'সতর্কতা: এটি সাধারণ তথ্য, রোগ নির্ণয় বা চিকিৎসার বিকল্প নয়।'
      : 'Disclaimer: this is general information, not a diagnosis or a substitute for medical care.'
  );

  return parts.join('\n');
}

/** Save a patient-edited summary. */
export async function saveEditedSummary(userId, summaryId, { summary, summaryText, status }) {
  const existing = await repo.findVisitSummary(summaryId, userId);
  if (!existing) {
    throw new HttpError(404, 'সারাংশ পাওয়া যায়নি।');
  }
  return repo.updateVisitSummary(summaryId, userId, { summary, summaryText, status });
}

/** Read the answers the patient gave while answering the follow-up questions. */
export function normaliseAnswers(input = {}) {
  const answers = {};
  if (input.main_symptom) answers.main_symptom = cleanText(input.main_symptom, 400);
  if (input.symptom_start) answers.symptom_start = cleanText(input.symptom_start, 40);
  if (input.symptom_frequency) answers.symptom_frequency = cleanText(input.symptom_frequency, 200);
  if (input.symptom_severity) answers.symptom_severity = cleanText(input.symptom_severity, 20);
  if (input.current_medication) answers.current_medication = cleanText(input.current_medication, 400);
  if (input.allergies) answers.allergies = cleanText(input.allergies, 400);
  if (input.patient_questions) answers.patient_questions = cleanText(input.patient_questions, 600);
  return answers;
}

export function normaliseExtraSymptoms(input = []) {
  if (!Array.isArray(input)) return [];
  return input
    .map((symptom) => ({
      name: cleanText(symptom?.name, 160),
      description: symptom?.description ? cleanMultiline(symptom.description, 500) : null,
      severity: ['mild', 'moderate', 'severe'].includes(symptom?.severity) ? symptom.severity : 'mild',
      startedAt: symptom?.startedAt || null,
      frequency: symptom?.frequency ? cleanText(symptom.frequency, 60) : null,
    }))
    .filter((symptom) => symptom.name);
}

export { cleanList };
