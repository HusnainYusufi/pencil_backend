# syntax=docker/dockerfile:1.7
#
# Targets:
#   runtime  the API (production deps only, non-root, no secrets baked in)
#   migrate  one-shot release job: prisma migrate deploy + seed + accounting backfill
#
# No secret ever enters an image: configuration arrives at run time through
# env files that live only on the server (see deploy/).

# ---- dependencies ------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

# ---- build -------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---- production dependencies only --------------------------------------------
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---- release job (migrations + seed + backfill) -------------------------------
FROM build AS migrate
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node
CMD ["npm", "run", "--silent", "db:release"]

# ---- runtime -----------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4100/api/health/live >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
