import { HttpError } from '../utils/http-error.js';
import { env } from '../config/env.js';

/**
 * Translate multer's upload errors into a clean HTTP response.
 *
 * Without this, an oversized or unexpected file would surface as a 500.
 */
function translateUploadError(error) {
  if (!error || typeof error.code !== 'string' || !error.code.startsWith('LIMIT_')) {
    return null;
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    const limitMb = Math.round(env.uploadMaxBytes / (1024 * 1024));
    return new HttpError(413, `ফাইলটির আকার ${limitMb} MB এর বেশি হতে পারে না।`);
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new HttpError(400, 'অপ্রত্যাশিত একটি ফাইল পাঠানো হয়েছে।');
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNLIMITED_FILES') {
    return new HttpError(400, 'একবারে একটির বেশি ফাইল পাঠানো যাবে না।');
  }
  return new HttpError(400, 'ফাইলটি আপলোড করা যায়নি।');
}

export function errorHandler(error, _req, res, _next) {
  const uploadError = translateUploadError(error);
  const finalError = uploadError || error;

  const status = Number.isInteger(finalError.status) ? finalError.status : 500;

  if (status >= 500) {
    // An unexpected error is logged with its stack so it can be traced. The
    // client only ever receives a generic message, so nothing about the
    // internals leaks out.
    if (finalError instanceof HttpError) {
      console.error(finalError.message);
    } else {
      console.error(finalError.stack || finalError.message);
    }
  }

  res.status(status).json({ error: status === 500 ? 'Internal server error.' : finalError.message });
}
