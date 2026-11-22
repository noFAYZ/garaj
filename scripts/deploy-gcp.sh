#!/usr/bin/env bash
# Deploy the API and the worker to Cloud Run, sized for Google Cloud's free tier.
#
#   PROJECT=<gcp project id> ./scripts/deploy-gcp.sh
#
# Settings come from .env.production at the repo root (gitignored). The whole file is one
# Secret Manager secret, mounted into every container as a file (ENV_FILE); never baked into
# the image or set as plain env vars. Migrations run before the new API starts (its drift check
# refuses otherwise). The worker is a job Cloud Scheduler starts every 5 minutes, not an
# always-on process: that is what keeps it free.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${PROJECT:?set PROJECT to the Google Cloud project id}"
REGION="${REGION:-us-east5}"                 # Ohio, beside Neon's aws us-east-2
SCHEDULER_REGION="${SCHEDULER_REGION:-us-central1}"
ENV_FILE="${ENV_FILE:-.env.production}"
BUDGET="${BUDGET:-5USD}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE (copy .env.example and fill it in)" >&2; exit 1; }

gc() { gcloud --project "$PROJECT" --quiet "$@"; }
RUN_SA="garaj-run@$PROJECT.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/garaj/server:$(date +%Y%m%d-%H%M%S)"

echo "== One-time setup (no-ops once done)"
gc services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com billingbudgets.googleapis.com
if ! gc artifacts repositories describe garaj --location "$REGION" >/dev/null 2>&1; then
  gc artifacts repositories create garaj --location "$REGION" --repository-format docker
  # Keep the two newest images: the free tier stores 0.5 GB.
  echo '[{"name":"keep-2","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":2}},{"name":"delete-rest","action":{"type":"Delete"},"condition":{"tagState":"any"}}]' >.cleanup-policy.json
  gc artifacts repositories set-cleanup-policies garaj --location "$REGION" --policy .cleanup-policy.json
  rm .cleanup-policy.json
fi
gc iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 ||
  gc iam service-accounts create garaj-run --display-name "Garaj API and worker"
gc projects add-iam-policy-binding "$PROJECT" --condition None \
  --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor >/dev/null
BILLING="$(gc billing projects describe "$PROJECT" --format 'value(billingAccountName)')"
BILLING="${BILLING#billingAccounts/}"
gc billing budgets list --billing-account "$BILLING" --billing-project "$PROJECT" \
  --format 'value(displayName)' | grep -qx garaj ||
  gc billing budgets create --billing-account "$BILLING" --billing-project "$PROJECT" \
    --display-name garaj --budget-amount "$BUDGET" --filter-projects "projects/$PROJECT" \
    --threshold-rule percent=0.5 --threshold-rule percent=1.0

echo "== Settings from $ENV_FILE"
# The port is Cloud Run's to set (--port below), so those two never go in.
SETTINGS="$(tr -d '\r' <"$ENV_FILE" | grep -vE '^(API_PORT|API_HOST)=')"
if ! gc secrets describe garaj-env >/dev/null 2>&1; then
  printf '%s\n' "$SETTINGS" | gc secrets create garaj-env --data-file=- --replication-policy automatic
elif [[ "$(gc secrets versions access latest --secret garaj-env)" != "$SETTINGS" ]]; then
  printf '%s\n' "$SETTINGS" | gc secrets versions add garaj-env --data-file=-
fi

echo "== Build $IMAGE"
gc builds submit --tag "$IMAGE" .

common=(--image "$IMAGE" --region "$REGION" --service-account "$RUN_SA"
  --set-secrets /secrets/.env=garaj-env:latest --set-env-vars ENV_FILE=/secrets/.env)

echo "== Migrate"
gc run jobs deploy garaj-migrate "${common[@]}" --max-retries 0 \
  --command node --args=--import,tsx,/app/packages/database/src/migrate.ts
gc run jobs execute garaj-migrate --region "$REGION" --wait

echo "== API"
gc run deploy garaj-api "${common[@]}" --port 3001 --allow-unauthenticated \
  --cpu 1 --memory 512Mi --min-instances 0 --max-instances 4

echo "== Worker (a job, every 5 minutes)"
gc run jobs deploy garaj-worker "${common[@]}" --max-retries 0 --task-timeout 5m \
  --cpu 1 --memory 512Mi \
  --command node --args=--import,tsx,/app/workers/worker/src/index.ts,--once
gc run jobs add-iam-policy-binding garaj-worker --region "$REGION" \
  --member "serviceAccount:$RUN_SA" --role roles/run.invoker >/dev/null
schedule=(http garaj-worker --location "$SCHEDULER_REGION" --schedule '*/5 * * * *'
  --uri "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/garaj-worker:run"
  --http-method POST --oauth-service-account-email "$RUN_SA")
if gc scheduler jobs describe garaj-worker --location "$SCHEDULER_REGION" >/dev/null 2>&1; then
  gc scheduler jobs update "${schedule[@]}"
else
  gc scheduler jobs create "${schedule[@]}"
fi

echo "== Old settings versions (each enabled one past 6 is billed)"
for version in $(gc secrets versions list garaj-env --filter 'state=ENABLED' \
  --sort-by '~createTime' --format 'value(name)' | tail -n +2); do
  gc secrets versions destroy "$version" --secret garaj-env
done

echo "== Done. API: $(gc run services describe garaj-api --region "$REGION" --format 'value(status.url)')"
