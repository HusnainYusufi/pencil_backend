# syntax=docker/dockerfile:1.7

# ---- dependencies ------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build (also used by the `migrate` compose service) ----------------------
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---- production dependencies only --------------------------------------------
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---- runtime -----------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S pencil && adduser -S pencil -G pencil
COPY --from=prod-deps --chown=pencil:pencil /app/node_modules ./node_modules
COPY --from=build --chown=pencil:pencil /app/dist ./dist
COPY --chown=pencil:pencil package.json ./
USER pencil
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4100/api/health/live >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
