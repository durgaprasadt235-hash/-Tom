# TOM Cloud — Safe Vercel Boundary

The deployable cloud surface. Deliberately separate from `workspace/`
(the privileged local TOM runtime).

## What lives here

- `public/index.html` — static landing page. Calls only `/api/health`
  and `/api/status`. A fresh minimal page: `workspace/public/*` was NOT
  reused because it calls privileged local endpoints (`/chat`, `/project`,
  `/file`, `/analyze-file`, `/tools/execute`, `/plugins`, `/health`
  with local-machine details).
- `api/health.js` — static safe health probe. No env, fs, process, or
  host information. Unchanged by the Neon integration.
- `api/status.js` — auth/local-agent placeholders plus live Neon database
  status (`connected` | `not_configured` | `unavailable`). Returns the
  status enum only — never connection strings or metadata.
- `api/lib/db.js` — shared Neon probe. Reads ONLY `process.env.DATABASE_URL`
  (Vercel-Neon integration), runs `SELECT 1` with a 5s timeout, maps every
  outcome to the status enum. Never logs, throws, or returns credentials.
- `scripts/verify-boundary.js` — runs as `npm run build` (also on Vercel);
  fails closed if any privileged reference enters the bundle.
- `tests/` — boundary regression tests.

## What is intentionally absent

Secrets, authentication, chat, tools execution, terminal/runtime
controls, filesystem access, VS Code integration, the DROP project.
The single sanctioned dependency is `@neondatabase/serverless` (Neon
database driver); `DATABASE_URL` is read server-side only and is never
committed, logged, or returned. Those arrive only through explicit future
boundary changes plus review.

## Database (Neon)

Vercel-Neon integration provides `DATABASE_URL` (Production + Preview).
`/api/status` reports `database.status` as `connected` (SELECT 1
succeeded), `not_configured` (no `DATABASE_URL`), or `unavailable`
(any failure). The landing page displays the status text only.
A Vercel redeploy is required to pick up this change (new dependency +
new serverless code).

## Local verification

```sh
cd cloud
npm run build        # boundary check (fails closed)
node --test tests/   # handler + boundary tests
```

## Vercel settings

Root Directory `cloud`, preset Other, build `npm run build`,
output `public`, install `npm install`. See task report for the full table.
