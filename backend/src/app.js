import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import chatRoutes from './routes/chat.routes.js';
import healthRoutes from './routes/health.routes.js';
import signalingRoutes from './routes/signaling.routes.js';
import { errorHandler } from './middleware/error-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const publicDir = path.join(projectRoot, 'frontend', 'public');

export const app = express();

// Vercel terminates TLS and forwards one trusted proxy hop. This also lets
// express-rate-limit read the real client IP without trusting arbitrary chains.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.corsOrigin.split(',').map((value) => value.trim()), credentials: false }));
app.use(express.json({ limit: '32kb' }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

app.use('/api', apiLimiter);
app.use('/api/health', healthRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/sig', signalingRoutes);
app.use(express.static(publicDir));

app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use(errorHandler);
