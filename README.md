# flashy-api

Sync + auth backend for [Flashy](../flashy). NestJS + Prisma + Postgres. Exposes email/password auth and a single `POST /sync` delta endpoint; the Flashy client stays local-first (Dexie/IndexedDB) and treats this as the cross-device merge point, not a live data source.

## Stack

- **NestJS 11** — HTTP layer, DI, guards.
- **Prisma 7** (`@prisma/adapter-pg` driver adapter) over **Postgres**.
- **Auth** — email/password (argon2) or "Sign in with Google" (ID-token verification via `google-auth-library`, accounts linked by verified email), both issuing the same JWT access token (15 min) + rotating refresh token (30 days, hashed at rest).
- **Sync** — push+pull delta with per-table server revision cursors, tombstone deletes, and content/scheduling split reconciliation. See `src/sync/sync.service.ts`.

## Local development

```bash
npm install
docker compose up -d postgres     # local Postgres on :5433
cp .env.example .env              # fill in the values below
npx prisma migrate dev            # apply migrations
npm run start:dev                 # http://localhost:3001
```

Health check: `curl http://localhost:3001/health` → `ok`.

## Environment variables

| Variable             | Required                | Notes                                                                                                                                                                                       |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes                     | Postgres connection string. Locally, the docker-compose value. In production, the Neon **direct** (unpooled) connection string — see below.                                                 |
| `JWT_ACCESS_SECRET`  | yes                     | Signs/verifies access tokens. Generate with `openssl rand -base64 32`.                                                                                                                      |
| `JWT_REFRESH_SECRET` | yes                     | Separate secret; reserved for refresh-token handling. Generate the same way.                                                                                                                |
| `GOOGLE_CLIENT_ID`   | yes, for Google sign-in | Verifies `POST /auth/google` ID tokens (checked as the `audience`). Same value as the frontend's `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; no client secret needed. See "Google sign-in setup" below. |
| `CORS_ORIGIN`        | yes                     | Comma-separated allowed origins for the browser client. Locally `http://localhost:3000`; in production your Vercel URL, e.g. `https://flashy.vercel.app`.                                   |
| `PORT`               | no                      | Defaults to 3001. Fly sets it via `fly.toml`.                                                                                                                                               |

## Google sign-in setup (one-time)

`POST /auth/google` verifies a Google ID token and links-or-creates a `User` by verified email, then issues our own JWTs exactly like `/auth/login` — Google only authenticates the person, it's never the session mechanism itself.

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID** → type **Web application**.
2. **Authorized JavaScript origins**: add `http://localhost:3000` and your production frontend URL (e.g. `https://flashy-drab.vercel.app`). No redirect URI is needed — this is the ID-token (Google Identity Services) flow, not the auth-code flow.
3. Copy the **Client ID** and set it as **both**:
   - `GOOGLE_CLIENT_ID` here (`.env` locally, `fly secrets set` in production)
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the frontend (`.env.local` locally, Vercel env in production)

Same value, no client secret — the secret is only needed for the auth-code flow this app doesn't use.

## Deployment (Fly.io + Neon)

The app is deployed as a Docker container on Fly; Postgres lives on Neon. `Dockerfile` and `fly.toml` are committed and the image build is verified.

### 1. Postgres on Neon

Create a Neon project and copy the connection string. **Use the direct (unpooled) string** — the host _without_ `-pooler`. A single always-on Fly machine holds one connection pool, so Neon's PgBouncer adds nothing, and `prisma migrate deploy` (run on every deploy) wants a direct connection. Co-locate the Neon region with the Fly `primary_region` (both London by default here: Neon `eu-west-2`, Fly `lhr`).

### 2. API on Fly

```bash
fly launch --no-deploy --copy-config --name flashy-api   # uses the committed fly.toml

fly secrets set \
  DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require" \
  JWT_ACCESS_SECRET="$(openssl rand -base64 32)" \
  JWT_REFRESH_SECRET="$(openssl rand -base64 32)" \
  GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  CORS_ORIGIN="https://your-app.vercel.app"

fly deploy
```

For GitHub-based auto-deploys on pushes to `main`, add a repository secret named `FLY_API_TOKEN` and use a Fly access token with deploy access to this app. This repo includes [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml), which also supports manual runs from the GitHub Actions UI via `workflow_dispatch`.

`fly.toml`'s `release_command` runs `npx prisma migrate deploy` before each new version takes traffic, so migrations apply automatically. The machine scales to zero when idle and cold-starts on the next request.

### 3. Point the client at it

In the Flashy (frontend) Vercel project, set **one** env var — `NEXT_PUBLIC_API_URL` = your Fly URL (e.g. `https://flashy-api.fly.dev`) — and redeploy. No secrets go on the frontend; `DATABASE_URL` and the JWT secrets live only here on Fly.

> **CORS + Vercel previews:** `CORS_ORIGIN` must include the exact Vercel origin the browser loads from. Preview deployments get random `*.vercel.app` URLs that won't match unless added — only relevant if you test cross-device sync from preview builds.

## Notes

- The wire protocol (`src/sync/sync.schema.ts`, `sync.types.ts`) is mirrored by hand in the client at `flashy/src/lib/sync/wire.ts` — the two projects deploy independently, so protocol changes must be made in both.
- `ownerId` is always derived from the verified JWT server-side and used to scope every query — clients never authorize via a client-sent `ownerId`.
