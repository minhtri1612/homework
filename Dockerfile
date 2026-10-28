# The website as a Docker image: docker compose up (see docker-compose.yml),
# pushed to Docker Hub by .github/workflows/docker.yml.

# Build stage: dev dependencies (tsc), the Prisma client and the browser JavaScript.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips postinstall: prisma generate needs prisma.config.js and src/load-env.ts.
RUN npm ci --ignore-scripts
COPY prisma.config.js tsconfig.json tsconfig.browser.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies only, run by Node's type stripping (no compile step).
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the Prisma client is generated in the build stage and copied below.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY prisma.config.js ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY examples ./examples
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
# data/ holds the SQLite file when DATABASE_URL is empty (a volume in docker-compose.yml).
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/server.ts"]
