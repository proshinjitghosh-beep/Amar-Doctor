import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import chatRoutes from './routes/chat.routes.js';
import healthRoutes from './routes/health.routes.js';
import signalingRoutes from './routes/signaling.routes.js';
import authRoutes from './routes/auth.routes.js';
import healthProfileRoutes from './routes/health-profile.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import medicationRoutes, { reminderRouter } from './routes/medications.routes.js';
import emergencyRoutes from './routes/emergency.routes.js';
import doctorPrepRoutes, { sharedRouter } from './routes/doctor-prep.routes.js';
import appointmentRoutes from './routes/appointments.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import internalRoutes from './routes/internal.routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { apiLimiter, chatLimiter } from './middleware/rate-limiters.js';

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

// Healthcare modules. These routers must be mounted before the /api 404
// catch-all below, otherwise they would never be reached.
//
// /api/auth and /api/reports/upload carry their own, endpoint-specific
// limits, so they are mounted ahead of the general /api limiter.
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/sig', signalingRoutes);

app.use('/api', apiLimiter);
app.use('/api/health-profile', healthProfileRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/reminders', reminderRouter);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/doctor-prep', doctorPrepRoutes);
app.use('/api/shared', sharedRouter);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/internal', internalRoutes);

app.use(express.static(publicDir));

app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use(errorHandler);
