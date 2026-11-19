import { z } from 'zod';

const schema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4000),
  })).min(1).max(30),
});

export function validateChat(req, res, next) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid chat payload. Each message needs a valid role and 1–4000 characters.' });
  }
  req.body = result.data;
  next();
}
