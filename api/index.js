// Vercel serverless entrypoint. The Express app serves both the API and the
// existing static frontend, so all incoming paths are rewritten here.
export { default } from '../server.js';
