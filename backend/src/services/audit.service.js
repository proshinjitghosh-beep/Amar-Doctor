import { pool } from '../config/database.js';

/**
 * Append-only audit trail.
 *
 * Only the fact that an action happened is recorded - never the medical
 * content of the record it refers to.
 */
export async function recordAudit({ userId = null, action, resourceType, resourceId = null }) {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, $4)`,
      [userId, String(action).slice(0, 60), String(resourceType).slice(0, 40), resourceId ? String(resourceId).slice(0, 80) : null]
    );
  } catch (error) {
    // An audit write must never break the user's request.
    console.error('Audit log write failed:', error.message);
  }
}

export async function listAudit({ userId, limit = 100 }) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, action, resource_type, resource_id, created_at
       FROM audit_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(500, Math.max(1, limit))]
  );
  return rows;
}
