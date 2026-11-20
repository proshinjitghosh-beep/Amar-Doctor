import {
  createSymptom,
  deleteSymptom,
  getHealthProfile,
  getOrCreateHealthProfile,
  listSymptoms,
  updateHealthProfile,
} from '../services/health-profile.service.js';
import { recordAudit } from '../services/audit.service.js';
import { HttpError } from '../utils/http-error.js';

export async function getProfile(req, res, next) {
  try {
    const profile = await getOrCreateHealthProfile(req.user.id, req.user.fullName);
    return res.json({ profile });
  } catch (error) {
    return next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const profile = await updateHealthProfile(req.user.id, req.body || {});
    await recordAudit({ userId: req.user.id, action: 'health_profile.update', resourceType: 'health_profile', resourceId: profile.id });
    return res.json({ profile });
  } catch (error) {
    return next(error);
  }
}

export async function listSymptomsEndpoint(req, res, next) {
  try {
    const symptoms = await listSymptoms(req.user.id, req.query?.limit);
    return res.json({ symptoms });
  } catch (error) {
    return next(error);
  }
}

export async function createSymptomEndpoint(req, res, next) {
  try {
    const symptom = await createSymptom(req.user.id, req.body || {});
    await recordAudit({ userId: req.user.id, action: 'symptom.create', resourceType: 'symptom', resourceId: symptom.id });
    return res.status(201).json({ symptom });
  } catch (error) {
    return next(error);
  }
}

export async function deleteSymptomEndpoint(req, res, next) {
  try {
    await deleteSymptom(req.user.id, req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export { HttpError };
