# Cloud Run package

Copy each file into your GitHub repo at the same path shown here
(this folder mirrors your repo root). Overwrite existing files.

| Path | Change |
|---|---|
| `Dockerfile` | New. Builds the api-server for Cloud Run (pins pnpm 10) |
| `.dockerignore` | New |
| `package.json` | Removed the Replit-only `@replit/connectors-sdk` |
| `pnpm-lock.yaml` | Regenerated for the dependency change. Required, or the build fails |
| `artifacts/api-server/package.json` | Removed Replit SDK, added `google-auth-library` |
| `artifacts/api-server/src/lib/google-client.ts` | New. Google auth that works outside Replit |
| `artifacts/api-server/src/lib/google-sync.ts` | Uses the new Google client |
| `artifacts/api-server/src/lib/google-sync.validation.ts` | Test updated to match |

## Environment variables for Cloud Run

| Name | Value |
|---|---|
| `DATABASE_URL` | Your Neon connection string |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Your OpenAI API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `NODE_ENV` | `production` |

`PORT` is set by Cloud Run automatically. No Google keys are needed:
Cloud Run supplies credentials through the attached service account.

## Checked in a clean environment
`pnpm install --frozen-lockfile` (pnpm 10), `tsc -b --force`, the Google sync
validation script and the production build all pass. The bundled output starts
standalone with no node_modules. The Docker image itself could not be built in
the test environment, so the first Cloud Build run is the first real test.
