# AGENTS.md

Project context for AI coding agents (Cascade, Codex, Cursor, etc.).
Read this file first before working on the codebase.

## Project Overview

Interactive Module 3 recap presentation with live multi-participant polling,
designed for classroom use and deployed on Google Cloud Run.

- **Presenter** opens `/` (serves `presenter.html`), creates a room, and controls polls.
- **Audience** opens `/audience.html`, joins with a 5-character room code, and votes.
- Real-time updates via Server-Sent Events (SSE).

## Tech Stack

- **Runtime**: Node.js >= 20, no build step
- **Dependencies**: none (pure Node.js standard library: `http`, `fs`, `path`, `url`, `crypto`)
- **Frontend**: vanilla HTML/JS/CSS in `public/` (no framework, no bundler)
- **Deployment**: Google Cloud Run via Dockerfile + `deploy-cloudrun.sh`
- **State**: in-memory (`Map`/`Set`) — no database, no persistence

## Project Structure

```
server.js              # All server logic: HTTP routes, SSE, room/vote state, file serving
public/
  presenter.html       # Presenter UI (creates rooms, controls polls, views live results)
  audience.html        # Audience UI (joins room, votes, sees results when revealed)
Dockerfile             # Container image definition
deploy-cloudrun.sh     # Cloud Run deployment script
cloudrun-service.yaml  # Cloud Run service manifest
package.json           # Scripts only (start, dev) — no dependencies
```

## Key Concepts

### Room State
Each room is stored in the `rooms` Map keyed by a 5-char code. State includes:
- `presenterToken` — prevents audience from controlling polls
- `activePoll` — current poll object or null
- `showResults` — boolean, presenter toggles to reveal/hide results
- `votes` — Map of clientId → { answer, at }
- `presenters` / `audience` — Sets/Maps of SSE response objects

### API Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/healthz` | none | Health check |
| GET | `/events` | room code (+ presenterToken for presenter role) | SSE stream |
| POST | `/api/create-room` | none | Create room, returns code + presenterToken |
| POST | `/api/join-room` | room code | Join room, returns current poll state |
| POST | `/api/set-poll` | presenterToken | Set active poll |
| POST | `/api/clear-poll` | presenterToken | Clear active poll |
| POST | `/api/show-results` | presenterToken | Toggle results visibility |
| POST | `/api/vote` | room code | Submit a vote |

### Environment Variables
- `PORT` — server port (default 8080; dev script sets 3000)
- `SSE_HEARTBEAT_MS` — SSE heartbeat interval (default 25000)
- `ROOM_TTL_MS` — idle room cleanup timeout (default 4 hours)
- `DISABLE_PRESENTER_TOKEN` — set to `"true"` to skip token checks (dev only)

## Development

```bash
npm install          # no-op (no dependencies)
npm run dev          # starts on port 3000
npm start            # starts on port 8080 (or PORT env)
```

## Coding Conventions

- **No external dependencies** — use only Node.js standard library. Do not add npm packages.
- **No build step** — edit files and refresh; no compilation or transpilation.
- **No test framework** — currently no automated tests exist.
- **Single-file server** — all server logic lives in `server.js`. Avoid splitting unless complexity demands it.
- **Vanilla frontend** — `presenter.html` and `audience.html` are self-contained (HTML + inline JS + inline CSS). No frameworks.
- **In-memory state** — do not introduce a database unless explicitly asked.
- **Security** — `safePath()` prevents directory traversal; `requirePresenter()` guards mutation endpoints. Preserve these patterns.

## Deployment

```bash
# Via script
PROJECT_ID="your-gcp-project" REGION="asia-southeast1" SERVICE_NAME="ml-module3-poll" ./deploy-cloudrun.sh

# Via gcloud directly
gcloud run deploy ml-module3-poll --source . --region asia-southeast1 \
  --allow-unauthenticated --timeout 3600 --max-instances 1 --concurrency 200
```

**Important**: `max-instances=1` is required because state is in-memory. Multiple instances would break room/vote consistency.
