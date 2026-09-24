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
  host information.
- `api/status.js` — auth/database/local-agent readiness placeholders.
  No secrets, no connection strings.
- `scripts/verify-boundary.js` — runs as `npm run build` (also on Vercel);
  fails closed if any privileged reference enters the bundle.
- `tests/` — boundary regression tests.

## What is intentionally absent

Neon, secrets, authentication, chat, tools execution, terminal/runtime
controls, filesystem access, VS Code integration, the DROP project.
Those arrive only through explicit future boundary changes plus review.

## Local verification

```sh
cd cloud
npm run build        # boundary check (fails closed)
node --test tests/   # handler + boundary tests
```

## Vercel settings

Root Directory `cloud`, preset Other, build `npm run build`,
output `public`, install `npm install`. See task report for the full table.
