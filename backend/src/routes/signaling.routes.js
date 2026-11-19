import { Router } from 'express';
import { z } from 'zod';

const router = Router();
const rooms = new Map();
const signalSchema = z.object({ from: z.string().max(80), data: z.unknown() });

router.post('/:roomId', (req, res) => {
  const roomId = req.params.roomId.slice(0, 40);
  const parsed = signalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid signaling payload.' });
  const room = rooms.get(roomId) || [];
  room.push(parsed.data);
  if (room.length > 300) room.splice(0, 100);
  rooms.set(roomId, room);
  return res.json({ ok: true });
});

router.get('/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId.slice(0, 40)) || [];
  const since = Math.max(0, Number.parseInt(req.query.since || '0', 10) || 0);
  return res.json({ n: room.length, m: room.slice(since) });
});

export default router;
