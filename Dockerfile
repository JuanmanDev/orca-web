# syntax=docker/dockerfile:1
# Multi-stage production image for orca-web.
# The app is a browser-only client — the container serves static assets and
# a thin Node server; pairing credentials never transit it.

# ---- build stage ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# pnpm via corepack, version pinned by package.json's packageManager field.
RUN corepack enable

# Workspace file carries allowBuilds (esbuild & friends) — pnpm 10+ refuses
# to run their install scripts without it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- runtime stage -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init for clean signal handling (Nuxt listens for SIGTERM).
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    # Nuxt 4 serves on PORT/HOST; HOST=0.0.0.0 is required inside containers.
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    NUXI_TLS=0

COPY --from=build /app/.output ./.output

# Non-root user (node exists in the official image).
USER node

EXPOSE 3000

# Nuxt's built output runs with `node .output/server/index.mjs`.
CMD ["dumb-init", "node", ".output/server/index.mjs"]
