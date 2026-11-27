# API, worker and migrations: one image, run three ways on Cloud Run (scripts/deploy-gcp.sh).
FROM node:26-slim
RUN npm install -g pnpm@11.29.0
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
# By default the worker runs inside the API's process (the second --import), as Render's free
# plan needs; Cloud Run overrides this to run them apart.
CMD ["node", "--import", "tsx", "--import", "/app/workers/worker/src/index.ts", "src/server.ts"]
