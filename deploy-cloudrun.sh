#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-ml-module3-poll}"
REGION="${REGION:-asia-southeast1}"
PROJECT_ARG=""

if [[ -n "${PROJECT_ID:-}" ]]; then
  PROJECT_ARG="--project=${PROJECT_ID}"
fi

gcloud run deploy "${SERVICE_NAME}" \
  ${PROJECT_ARG} \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --timeout 3600 \
  --max-instances 1 \
  --concurrency 200 \
  --cpu 1 \
  --memory 512Mi \
  --set-env-vars NODE_ENV=production,SSE_HEARTBEAT_MS=25000,ROOM_TTL_MS=14400000
