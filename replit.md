# ZAMECO I Service Memo Scraper

Mobile-first PWA for scanning, enhancing, extracting, reviewing, and syncing ZAMECO I service memos.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Managed integrations: Replit OpenAI AI Integration, Google Drive, Google Sheets

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/zameco-service-memo/` — React PWA and on-device image processing
- `artifacts/api-server/src/routes/` — memo, OCR, settings, and sync endpoints
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/` — memo and settings persistence

## Architecture decisions

- Image cleanup and compression run in the browser before upload to reduce field data usage.
- OCR uses Replit's managed OpenAI integration; users do not provide model API keys.
- Verified images sync to Google Drive and structured rows append to Google Sheets.
- Service memo codes are date-based with a daily four-digit sequence.

## Product

- Android camera capture or gallery upload
- Crop, grayscale, contrast, format, and quality controls
- AI extraction with confidence/warnings and editable verification
- Searchable memo history with Drive/Sheets sync status and retry
- Configurable Drive folder, spreadsheet, and sheet tab

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
