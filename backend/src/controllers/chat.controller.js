import { getHealthGuidance } from '../services/groq.service.js';
import { emergencyReply, hasEmergencyRedFlag } from '../utils/triage.js';
import { HttpError } from '../utils/http-error.js';

export async function postChat(req, res, next) {
  try {
    const { messages } = req.body;
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!latestUserMessage) throw new HttpError(400, 'At least one user message is required.');

    if (hasEmergencyRedFlag(latestUserMessage.content)) {
      return res.json(emergencyReply());
    }

    const result = await getHealthGuidance(messages);
    return res.json(result);
  } catch (error) {
    next(error);
  }
}
