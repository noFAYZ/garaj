# API, worker and migrations: one image, run three ways on Cloud Run (scripts/deploy-gcp.sh).
FROM node:26-slim
RUN npm install -g pnpm@11.12.0
ENV CI=true
WORKDIR /app
COPY . .
# Only what the API, the worker and the database package need, never the apps' front ends.
RUN pnpm install --frozen-lockfile --filter "@vehicle-os/api..." --filter "@vehicle-os/worker..."
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
# ponytail: runs TypeScript through tsx, as dev does (workspace packages ship as source).
# Bundle with esbuild if cold starts ever matter.
CMD ["node", "--import", "tsx", "src/server.ts"]
