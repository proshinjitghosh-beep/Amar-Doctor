import { Router } from 'express';
import { postChat } from '../controllers/chat.controller.js';
import { validateChat } from '../middleware/validate-chat.js';

const router = Router();
router.post('/', validateChat, postChat);
export default router;
