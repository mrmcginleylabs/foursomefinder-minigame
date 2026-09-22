# 4SF Par 3 Challenge — Sidecar (Vercel)

This is the **decoupled frontend** for the Foursome Finder mini-game. It is a
standalone static Vite app that hosts the Canvas/physics/CSS game logic, while
sharing the **exact same Base44 backend, database, and unified auth** as the
main Foursome Finder app.

## Architecture

- **Frontend (this repo):** vanilla Vite + the 2D Canvas game + a thin
  orchestration layer. No React, no imports from the core scheduling app.
- **Backend (shared):** calls the Foursome Finder Base44 backend via the SDK
  (`createClient({ appId })`) — same database, same `MiniGameScore` /
  `MiniGameWinner` entities, same backend functions
  (`get-daily-game-config`, `get-daily-leaderboard`, `submit-game-score`,
  `migrate-guest-score`, `get-hall-of-fame`).
- **Auth pass-through:** when embedded inside the Foursome Finder app via
  iframe, the parent hands the member's active access token to this game over
  `postMessage` (origin-verified), so logged-in members are instantly
  authenticated with no second login. When visited directly, the game runs its
  own login via the shared SDK auth.

## Deploy to Vercel

1. **Create a new repo** from the contents of this folder (everything in
   `src/sidecar/` becomes the repo root).
2. In Vercel, **Import** the repo.
   - Framework preset: **Vite**
   - Root directory: the repo root (where `index.html` lives)
   - Build command: `npm run build` · Output dir: `dist`
3. **Environment variables** (Vercel → Settings → Environment Variables), see
   `.env.example`:
   - `VITE_BASE44_APP_ID` — the Foursome Finder app id (from its API page)
   - `VITE_ALLOWED_PARENT_ORIGINS` — comma list of main-app origins allowed to
     pass the auth token (e.g.
     `https://steadfast-fairway-foursome-find.base44.app,https://foursomefinder.com,https://www.foursomefinder.com`)
4. **Connect the subdomain** `play.foursomefinder.com` to the Vercel project
   (Vercel → Settings → Domains). Add the matching DNS record at your registrar.
5. Deploy. Visit `https://play.foursomefinder.com` to verify the game loads.

## After deploy

Back in the Foursome Finder app, the in-app `/play` route embeds
`https://play.foursomefinder.com` in a secure iframe and passes the member
token through — members play without leaving the app. Once confirmed, you can
delete this staging copy (`src/sidecar/`) from the Foursome Finder repo.
