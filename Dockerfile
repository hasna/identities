# syntax=docker/dockerfile:1
# @hasna/identities self_hosted service — ARM64 / Bun.
# Default CMD runs identities-serve (cloud / PURE REMOTE per Amendment A1).
# The ECS one-shot migration task overrides the command with `... migrate`.

FROM --platform=linux/arm64 oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM --platform=linux/arm64 oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN bun run build

FROM --platform=linux/arm64 oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HASNA_IDENTITIES_STORAGE_MODE=cloud \
    HOST=0.0.0.0 \
    PORT=8080
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
# Fail-closed: serve refuses to start without cloud env (no silent stub).
CMD ["bun", "dist/src/server/index.js"]
