# syntax=docker/dockerfile:1

# ---- Build stage ----------------------------------------------------------
FROM node:22-slim AS builder

# Pin pnpm to v10: newer pnpm (v12, corepack's current default) does not
# honor the "onlyBuiltDependencies" allowlist in pnpm-workspace.yaml the
# same way, and blocks esbuild's postinstall script behind an interactive
# approval gate that fails non-interactively in a Docker build.
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /repo

# Copy the whole monorepo. Workspace packages (lib/db, lib/api-zod,
# lib/integrations-openai-ai-server, etc.) are interdependent via
# "workspace:*", so pnpm needs the full workspace present to resolve and
# install correctly.
COPY . .

RUN pnpm install --frozen-lockfile

# Build only the api-server package. Its own build script (build.mjs) uses
# esbuild to bundle the app — including its workspace dependencies — into a
# single self-contained dist/index.mjs, so the runtime stage below doesn't
# need node_modules at all.
RUN pnpm --filter @workspace/api-server run build

# ---- Runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app

# Only the bundled output is needed at runtime.
COPY --from=builder /repo/artifacts/api-server/dist ./dist

ENV NODE_ENV=production
# Cloud Run sets PORT automatically at deploy time; 8080 is its default.
ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
