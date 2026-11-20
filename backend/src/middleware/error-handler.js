import { HttpError } from '../utils/http-error.js';

export function errorHandler(error, _req, res, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;

  if (status >= 500) {
    // An unexpected error is logged with its stack so it can be traced. The
    // client only ever receives a generic message, so nothing about the
    // internals leaks out.
    if (error instanceof HttpError) {
      console.error(error.message);
    } else {
      console.error(error.stack || error.message);
    }
  }

  res.status(status).json({ error: status === 500 ? 'Internal server error.' : error.message });
}
