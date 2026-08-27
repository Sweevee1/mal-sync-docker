# MAL-Sync Docker

A self-hosted, one-way sync tool: **MyAnimeList is the source of truth** for your anime and manga lists, and changes get pushed out to AniList and Kitsu on a schedule and on demand. No browser, no site-detection, just API-to-API syncing.

## Installing on Unraid

A pre-built image is published to GHCR on every push: `ghcr.io/sweevee1/mal-sync-docker:latest`.

1. Generate an encryption key for stored credentials — open Unraid's built-in web **Terminal** (the `>_` icon, top-right of any page) and run:
   ```sh
   openssl rand -base64 32
   ```
2. In the Unraid **Docker** tab, click **Add Container**.
3. Fill in:
   | Field | Value |
   |---|---|
   | Name | `mal-sync-docker` |
   | Repository | `ghcr.io/sweevee1/mal-sync-docker:latest` |
   | Network Type | `Bridge` |
   | Port | Container `3000` → Host `3000` (or any free host port) |
   | Path | Container `/app/data` → Host `/mnt/user/appdata/mal-sync-docker` |
4. Add these as **Variables**:
   | Variable | Value |
   |---|---|
   | `ENCRYPTION_KEY` | the value generated in step 1 |
   | `PORT` | `3000` (optional) |
   | `DEFAULT_SYNC_INTERVAL_MINUTES` | `60` (optional) |
   | `TRUST_PROXY` | `false` (optional) — only set `true` if a reverse proxy sits in front (see [`TRUST_PROXY`](#trust_proxy) below) |
5. Apply, then open `http://<your-unraid-ip>:3000` (your server's actual LAN IP, not `localhost` — the app reads the redirect/homepage URLs it shows you from whatever address you access it with). Go to **Connect Services** and connect MyAnimeList, AniList, and Kitsu (see [Getting Your API Credentials](#getting-your-api-credentials) below; entirely done in the UI, no env editing needed).
6. Click **Sync now** on the Dashboard, or just wait for the scheduled interval.

The SQLite database lives at `/mnt/user/appdata/mal-sync-docker/malsync.db` on the host, so it survives container updates/recreation.

If `ghcr.io/sweevee1/mal-sync-docker:latest` fails to pull with a permission/authentication error, the GHCR package may still be private — no login is needed once it's public (this is a one-time setting on the GitHub side, not something you need to change).

## Installing anywhere else with Docker Compose

```sh
git clone https://github.com/Sweevee1/mal-sync-docker.git
cd mal-sync-docker
cp .env.example .env
```

Fill in `.env` (see the table above for what each value means), then:

```sh
docker compose up --build
```

Then open `http://localhost:3000` and continue from step 5 above.

## Getting Your API Credentials

MyAnimeList and AniList each require you to register a small OAuth app on their own site and give this app the resulting Client ID (and, for AniList, Client Secret). Both are entered on the **Connect Services** page in the UI, not `.env`, and the secret is encrypted at rest the same way tokens are.

### MyAnimeList
1. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) and create a new client.
2. App Type: `other`. No client secret is required; this app authenticates via PKCE.
3. The **Connect Services** page shows the exact redirect URI to register (based on the URL you're accessing the app from, e.g. `http://localhost:3000/api/auth/mal/callback`).
4. Paste the client ID into the Client ID field on that page and save.

### AniList
1. Go to [anilist.co/settings/developer](https://anilist.co/settings/developer) and create a new client.
2. The **Connect Services** page shows the exact redirect URI to register (e.g. `http://localhost:3000/api/auth/anilist/callback`).
3. Paste the client ID and secret into the fields on that page and save.
4. Before connecting, set your AniList account's scoring format to **Point (10)** at [anilist.co/settings](https://anilist.co/settings). This app pushes MAL's 0-10 scores through as-is, without converting between scoring formats.

### Kitsu
No app registration needed. On the **Connect Services** page you have two options:

- **Local login**: type your Kitsu username and password in; they stay in your browser and only fill in a `curl` command shown on the page. You run that command yourself, directly against Kitsu's HTTPS endpoint, then paste the resulting `access_token` and `refresh_token` into the app. Your password never touches this server at all, so this works regardless of whether the app itself is on HTTP or HTTPS. Trade-off: without a stored password, the app can't silently redo the password grant if the refresh token stops working, so you'll need to paste a fresh token when that happens.
- **Password (HTTPS)**: the app performs an OAuth2 password grant on your behalf. Your password is stored encrypted at rest (`ENCRYPTION_KEY`) and is only used again to re-authenticate if a token refresh fails. **This method is only available over HTTPS.** If the app detects it's being served over plain HTTP, this tab's fields are disabled (not hidden) and the server rejects the request even if called directly, since it would otherwise send your password in the clear. To enable it, put the app behind a reverse proxy that terminates HTTPS and set `TRUST_PROXY=true` (see below).

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

All state (credentials, cached list data, sync history) lives in a single SQLite file at `/app/data/malsync.db` inside the container — the Unraid path mapping above, or the `malsync-data` Docker volume if you're using `docker compose`. Back that path up if you want to preserve sync history and avoid re-authenticating after a rebuild.
