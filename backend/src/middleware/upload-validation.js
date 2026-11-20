import multer from 'multer';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

/**
 * Magic byte prefixes used to confirm the uploaded bytes really are the file
 * type they claim to be. Checking the extension alone would let any file be
 * stored as if it were a PDF.
 */
const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function matches(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

/**
 * Identify the real type of an upload from its leading bytes.
 * WebP is RIFF-based ("RIFF....WEBP") and is checked separately.
 */
export function detectFileType(buffer) {
  if (!buffer || !buffer.length) return null;
  for (const signature of SIGNATURES) {
    if (matches(buffer, signature.bytes)) return signature.mime;
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('latin1');
    const webp = buffer.subarray(8, 12).toString('latin1');
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return null;
}

/**
 * Validate an uploaded file's declared type, extension, real signature and
 * size. Throws an HttpError with a Bangla message when something is wrong.
 */
export function validateUpload(file) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new HttpError(400, 'ফাইল পাওয়া যায়নি। আবার চেষ্টা করুন।');
  }

  if (file.size > env.uploadMaxBytes) {
    const limitMb = Math.round(env.uploadMaxBytes / (1024 * 1024));
    throw new HttpError(413, `ফাইলটির আকতি ${limitMb} MB এর বেশি হতে পারে না।`);
  }

  const extension = `.${String(file.originalname || '').split('.').pop()?.toLowerCase() || ''}`;
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new HttpError(400, 'শুধু PDF, JPG, PNG বা WebP ফাইল গ্রহণযোগ্য।');
  }

  if (!ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
    throw new HttpError(400, 'ফাইলের ধরনটি গ্রহণযোগ্য নয়।');
  }

  const detected = detectFileType(file.buffer);
  if (!detected) {
    throw new HttpError(400, 'ফাইলটির প্রকৃত বিষয়বস্তু পড়া গেল না। সঠিক ফাইল নির্বাচন করুন।');
  }
  if (detected !== file.mimetype) {
    throw new HttpError(400, 'ফাইলের নাম ও প্রকৃত বিষয়বস্তু মিলছে না।');
  }

  return { detectedType: detected };
}

/** Multer configured to keep uploads in memory so they can be validated. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxBytes, files: 1 },
});
