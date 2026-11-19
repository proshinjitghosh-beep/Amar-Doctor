# Architecture

```text
Browser
  |
  | static pages (frontend/public)
  | POST /api/chat
  v
Express application (backend/src/server.js)
  |
  +-- routes/       HTTP route definitions
  +-- controllers/  request/response handling
  +-- services/     DeepSeek integration and triage
  +-- middleware/  rate limiting, validation, error handling
  +-- config/      environment and database pool
  +-- utils/       shared helpers and migration runner
  |
  +-- PostgreSQL (schema foundation in database/migrations)
```

## Why the original screens are still HTML

The supplied prototype already contains working page markup and styling. They have been preserved under `frontend/public` to avoid throwing away the existing UI. The backend has been separated into maintainable modules. A React/Vite conversion should be a separate phase so each page can be migrated and tested without breaking the current experience.

## Next implementation phases

1. Move demo login/OTP to secure server-side authentication and role-based access.
2. Connect doctor profiles and appointments to PostgreSQL.
3. Add clinician-reviewed medical-record workflows with strict access controls and audit logs.
4. Integrate a licensed payment provider using server-side verification; never store card PINs.
5. Replace in-memory video signaling with a managed WebRTC signaling service.
6. Migrate the existing HTML screens to React/Vite component-by-component if desired.
7. Add deployment, monitoring, backups, privacy review and security testing.
