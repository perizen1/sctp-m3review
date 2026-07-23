# Module 3 Live Poll Recap — Cloud Run package

This package contains the interactive Module 3 recap presentation with live multi-participant polls.

## What was added for Cloud Run

- `Dockerfile` for container deployment.
- `deploy-cloudrun.sh` with recommended classroom settings.
- `/healthz` endpoint for service checks.
- Server-Sent Events heartbeat every 25 seconds.
- Graceful shutdown on `SIGTERM`.
- Presenter-control token so audience users cannot start, clear or reveal polls.
- Room cleanup after idle sessions.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the presenter view. Learners open `/audience.html` and enter the room code.

## Deploy to Cloud Run from source

```bash
PROJECT_ID="your-gcp-project" REGION="asia-southeast1" SERVICE_NAME="ml-module3-poll" ./deploy-cloudrun.sh
```

Or run directly:

```bash
gcloud run deploy ml-module3-poll \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --timeout 3600 \
  --max-instances 1 \
  --concurrency 200 \
  --cpu 1 \
  --memory 512Mi \
  --set-env-vars NODE_ENV=production,SSE_HEARTBEAT_MS=25000,ROOM_TTL_MS=14400000
```

## Recommended Cloud Run settings

- `max-instances=1` because room state is stored in memory.
- `concurrency=200` for classroom-size polling.
- `timeout=3600` to support a long live session.
- `min-instances=0` for lowest cost.

## Important production note

This package stores rooms and votes in memory. That is acceptable for a single classroom session on one Cloud Run instance. For repeated production use, move room state and votes to Firestore, Redis or another shared store before allowing multiple instances.
