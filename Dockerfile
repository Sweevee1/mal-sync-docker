# syntax=docker/dockerfile:1

FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend-build
WORKDIR /app/backend
# node:20-alpine ships without OpenSSL at all, so `prisma generate` can't
# detect a libssl version and silently guesses wrong (defaults to
# openssl-1.1.x even when none is present); that mismatched/missing engine
# binary then fails to load at runtime. Installing it here lets Prisma
# correctly detect Alpine's actual OpenSSL 3.x and fetch the matching engine.
RUN apk add --no-cache openssl
COPY tsconfig.base.json /app/tsconfig.base.json
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Same reasoning as the backend-build stage: the actual engine binary loaded
# at runtime (by `prisma migrate deploy` in CMD) needs the real libssl
# present, not just a correctly-generated engine from the build stage.
RUN apk add --no-cache openssl
# Fixed path inside the image's data volume; same for every Docker deployment
# (compose, Unraid, plain `docker run`), so it's a baked-in default rather than
# something every user has to remember to set. An explicit -e/env_file
# DATABASE_URL still overrides this if ever needed.
ENV DATABASE_URL=file:/app/data/malsync.db

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY --from=backend-build /app/backend/prisma ./prisma
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-build /app/backend/node_modules/@prisma ./node_modules/@prisma
COPY --from=frontend-build /app/frontend/dist ./public

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
