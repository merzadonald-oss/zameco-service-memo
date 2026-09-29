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

# Build the website. Its Vite config insists on PORT and BASE_PATH being set
# even for a production build, so provide them here ("/" = served from the
# root of the same server as the API).
RUN PORT=3000 BASE_PATH=/ NODE_ENV=production \
    pnpm --filter @workspace/zameco-service-memo run build

# ---- Runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app

# Only the built output is needed at runtime: the bundled API server and the
# built website that it serves.
COPY --from=builder /repo/artifacts/api-server/dist ./dist
COPY --from=builder /repo/artifacts/zameco-service-memo/dist/public ./public

ENV NODE_ENV=production
ENV STATIC_DIR=/app/public
# Cloud Run sets PORT automatically at deploy time; 8080 is its default.
ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
