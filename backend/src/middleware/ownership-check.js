import { HttpError } from '../utils/http-error.js';

/**
 * Assert that a record belongs to the requesting user.
 *
 * A record owned by someone else is reported as "not found" rather than
 * "forbidden", so the API never confirms that another patient's record exists.
 */
export function assertOwner(row, userId, resourceName = 'রেকর্ড') {
  if (!row) {
    throw new HttpError(404, `${resourceName} পাওয়া যায়নি।`);
  }
  const ownerId = Number(row.user_id ?? row.userId ?? row.patient_id);
  if (Number(ownerId) !== Number(userId)) {
    throw new HttpError(404, `${resourceName} পাওয়া যায়নি।`);
  }
  return row;
}

/**
 * Wrap an async controller so rejected promises reach the error handler.
 * (Express 4 does not forward async errors on its own.)
 */
export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
