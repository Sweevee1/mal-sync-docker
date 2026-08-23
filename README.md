# MAL-Sync Docker

A self-hosted, one-way sync tool: **MyAnimeList is the source of truth** for your anime and manga lists, and changes get pushed out to AniList and Kitsu on a schedule and on demand. No browser, no site-detection, just API-to-API syncing.

## Quickstart

1. Copy the env template and fill it in (see [Getting Your API Credentials](#getting-your-api-credentials) below):
   ```sh
   cp .env.example .env
   ```
2. Generate an encryption key for stored credentials:
   ```sh
   openssl rand -base64 32
   ```
   Put the output in `ENCRYPTION_KEY` in `.env`.
3. Start the app:
   ```sh
   docker compose up --build
   ```
4. Open `http://localhost:3000`, go to **Connect Services**, and connect MyAnimeList, AniList, and Kitsu.
5. Click **Sync now**, or just wait for the scheduled interval (configurable on the Dashboard).

## Getting Your API Credentials

### MyAnimeList
1. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) and create a new client.
2. App Type: `other`. No client secret is required; this app authenticates via PKCE.
3. Set the redirect URI to match `MAL_REDIRECT_URI` in `.env` (default: `http://localhost:3000/api/auth/mal/callback`).
4. Put the client ID in `MAL_CLIENT_ID`.

### AniList
1. Go to [anilist.co/settings/developer](https://anilist.co/settings/developer) and create a new client.
2. Set the redirect URI to match `ANILIST_REDIRECT_URI` in `.env` (default: `http://localhost:3000/api/auth/anilist/callback`).
3. Put the client ID and secret in `ANILIST_CLIENT_ID` / `ANILIST_CLIENT_SECRET`.
4. Before connecting, set your AniList account's scoring format to **Point (10)** at [anilist.co/settings](https://anilist.co/settings). This app pushes MAL's 0-10 scores through as-is, without converting between scoring formats.

### Kitsu
No app registration needed. On the **Connect Services** page you have two options:

- **Username & password**: the app performs an OAuth2 password grant on your behalf. Your password is stored encrypted at rest (`ENCRYPTION_KEY`) and is only used again to re-authenticate if a token refresh fails. **This method is only available over HTTPS.** If the app detects it's being served over plain HTTP, this option is hidden in the UI and the server rejects the request even if called directly, since it would otherwise send your password in the clear. To enable it, put the app behind a reverse proxy that terminates HTTPS and set `TRUST_PROXY=true` (see below).
- **Paste a token**: run the password grant yourself, directly against Kitsu's HTTPS endpoint (the onboarding page shows the exact `curl` command), then paste the resulting `access_token` and `refresh_token` into the app. Your password never touches this server at all, so this works regardless of whether the app itself is on HTTP or HTTPS. Trade-off: without a stored password, the app can't silently redo the password grant if the refresh token stops working, so you'll need to paste a fresh token when that happens.

#### `TRUST_PROXY`

By default (`TRUST_PROXY=false`), the app only considers a connection HTTPS if it's *literally* an HTTPS connection to the app itself, which never happens in the default Docker setup (the container only speaks plain HTTP). If you put a reverse proxy in front that terminates HTTPS (Caddy, nginx, Traefik, Cloudflare Tunnel, etc.), set `TRUST_PROXY=true` so the app trusts the proxy's `X-Forwarded-Proto` header and unlocks Kitsu password login. **Only enable this if a reverse proxy actually sits in front of the app.** If the container's port is exposed directly, a client could forge that header to fake HTTPS and defeat the protection entirely.

## How syncing works

- MAL's anime and manga lists are the source of truth. Nothing is ever read back from AniList/Kitsu to modify MAL.
- A background job runs every `syncIntervalMinutes` (configurable on the Dashboard); you can also trigger a sync manually.
- Every ~24 hours, a sync does a **full pass** over your entire MAL list (rather than just recently-changed entries) to detect removals. If a title is missing from your MAL list, it's flagged as **pending removal** in the Library view. Nothing is deleted from AniList/Kitsu automatically; you confirm each removal explicitly.
- Titles that can't be matched between services (e.g. very obscure releases) are logged as "no match" and skipped without failing the rest of the sync.
- AniList scores are pushed as a direct 0-10 passthrough, so make sure your AniList account uses Point (10) scoring (see above).

## Development

```sh
npm install
npm run dev:backend    # backend on :3000
npm run dev:frontend   # vite dev server, proxies /api to :3000
```

The backend needs a local `DATABASE_URL` (e.g. `file:./backend/prisma/dev.db`) and the rest of the vars from `.env.example` to boot. Run migrations with:

```sh
npm run prisma:migrate
```

## Data & backups

All state (credentials, cached list data, sync history) lives in a single SQLite file inside the `malsync-data` Docker volume at `/app/data/malsync.db`. Back that volume up if you want to preserve sync history and avoid re-authenticating after a rebuild.
