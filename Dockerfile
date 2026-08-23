# syntax=docker/dockerfile:1

FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

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
