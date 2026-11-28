# Development

```bash
npm install
npm run dev:backend    # :3000
npm run dev:frontend   # Vite on :5173, proxies /api
npm test -w backend
```

Create `backend/.env` from `.env.example` with `DATABASE_URL=file:./prisma/dev.db` (or an absolute `file:` path if the database will not open) and `PUBLIC_BASE_URL=http://localhost:5173`. Apply migrations with `npm run prisma:migrate`. Without `ADMIN_PASSWORD_HASH` (make one with `npm run hash-password -w backend`), set a password in the browser using the setup code in the backend log.
