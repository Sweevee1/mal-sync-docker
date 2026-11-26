# syntax=docker/dockerfile:1

# Pinned by digest so a retagged upstream image can't change what we ship;
# Dependabot's docker ecosystem bumps the digest.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
WORKDIR /app

# Every stage installs from the one root lockfile. All workspace manifests must
# be present for `npm ci` to validate the lockfile, even when only one
# workspace is installed via --workspace.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

FROM manifests AS frontend-build
RUN npm ci --ignore-scripts --workspace frontend
COPY tsconfig.base.json ./
COPY frontend/ frontend/
RUN npm run build --workspace frontend

# node:alpine ships without OpenSSL, so `prisma generate` can't detect a libssl
# version and guesses wrong; the resulting engine fails to load at runtime with
# an unparseable error. Installing it lets Prisma pick the matching engine.
FROM manifests AS backend-build
RUN apk add --no-cache openssl
RUN npm ci --ignore-scripts --workspace backend
COPY tsconfig.base.json ./
COPY backend/ backend/
RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run build --workspace backend

# Production-only node_modules (hoisted to /app/node_modules by the workspace
# layout). Scripts are disabled, so the Prisma engine download and client
# generation are run explicitly; the build fails if the schema engine that
# `migrate deploy` needs is missing.
FROM manifests AS prod-deps
RUN apk add --no-cache openssl
RUN npm ci --omit=dev --ignore-scripts --workspace backend && npm cache clean --force
COPY backend/prisma backend/prisma
RUN node node_modules/@prisma/engines/scripts/postinstall.js \
    && node node_modules/prisma/build/index.js generate --schema backend/prisma/schema.prisma \
    && ls node_modules/@prisma/engines/ | grep -q '^schema-engine' \
    && test -d node_modules/.prisma/client

FROM base AS runtime
# tini reaps zombies and forwards signals to node; su-exec drops root after the
# entrypoint has fixed ownership of the data volume. openssl is needed at
# runtime by the Prisma engines, not just at generate time.
RUN apk add --no-cache openssl tini su-exec \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-*

ENV NODE_ENV=production \
    HOME=/tmp \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
# Fixed path inside the image's data volume; same for every Docker deployment
# (compose, Unraid, plain `docker run`), so it's a baked-in default rather than
# something every user has to remember to set. An explicit -e/env_file
# DATABASE_URL still overrides this if ever needed.
ENV DATABASE_URL=file:/app/data/malsync.db

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY backend/package.json backend/
COPY --from=backend-build /app/backend/dist backend/dist
COPY backend/prisma backend/prisma
COPY --from=frontend-build /app/frontend/dist backend/public

# 99:100 is Unraid's nobody:users. The entrypoint re-owns the volume at start
# to PUID/PGID (same defaults), since a host-mounted dir arrives root-owned.
RUN mkdir -p /app/data && chown 99:100 /app/data && chmod 700 /app/data
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod 755 /docker-entrypoint.sh

WORKDIR /app/backend
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]
