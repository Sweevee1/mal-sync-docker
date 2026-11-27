# MAL-Sync Docker

A self-hosted, one-way sync tool: **MyAnimeList is the source of truth** for your anime and manga lists, and changes get pushed out to AniList and Kitsu on a schedule and on demand. No browser, no site-detection, just API-to-API syncing.

The app is protected by a single owner password. Every page and API route except the login, the health check, and the two OAuth callbacks requires a signed-in session.

## Installing on Unraid

A pre-built image is published to GHCR on every push to `master`: `ghcr.io/sweevee1/mal-sync-docker:latest`.

### Upgrading from an earlier version

Nothing breaks. If you already set `ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH` and `PUBLIC_BASE_URL`, they keep working. On the first start of this version the app also copies the key into `encryption.key` and the password hash into its database, so you can delete those two variables afterward with no change in your password or connected services. Keep `PUBLIC_BASE_URL` if you use a tunnel or an `https://` address (see below).

If you connected MAL or AniList before the login was added, their redirect URIs may still point at an old address. The **Connect Services** page shows the exact values to register.

### First install

1. In the Unraid **Docker** tab, click **Add Container**.
2. Fill in:
   | Field | Value |
   |---|---|
   | Name | `mal-sync-docker` |
   | Repository | `ghcr.io/sweevee1/mal-sync-docker:latest` |
   | Network Type | `Bridge` for a LAN-only install, or your custom network if you use [Cloudflare Tunnel](#making-it-public-with-cloudflare-tunnel) |
   | Port | Container `3000` to Host `3000` (change the host port if 3000 is taken; the container port is fixed) |
   | Path | Container `/app/data` to Host `/mnt/user/appdata/mal-sync-docker` |

   That is all. No variables are needed for a LAN-only install.
3. Apply, then open the container's **Logs**. It prints a line like `No admin password is set. Open the web UI and set one, using this setup code: ...`.
4. Open the web UI (`http://<unraid-ip>:3000`). It asks for a new password (at least 12 characters) and the setup code from the log. The code proves you control the server, so a stranger who finds the port first cannot claim it. A new code is made each time the container starts until you finish this step.
5. Go to **Connect Services** and connect MyAnimeList, AniList, and Kitsu (see [Getting Your API Credentials](#getting-your-api-credentials) below; all done in the UI).
6. Click **Sync now** on the Dashboard, or wait for the scheduled interval.

Optional variables, added in the same dialog under **Variables**:

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_BASE_URL` | unset | The exact URL you browse to, with no path and no trailing slash, for example `https://malsync.example.com`. **Required when the app is reached through a tunnel or reverse proxy, or over `https://`.** When unset, the app trusts the address in your browser's `Host` header, but only for connections from loopback and private LAN addresses. |
| `TRUST_PROXY` | `false` | Set `true` when the app is behind Cloudflare Tunnel or any reverse proxy (see [`TRUST_PROXY`](#trust_proxy) below). Required if `PUBLIC_BASE_URL` starts with `https://`. |
| `TRUST_PROXY_CIDRS` | `loopback` | Comma-separated IP addresses or subnets of the proxy container, for example `172.30.0.0/24`. See [Finding the proxy address](#finding-the-proxy-address). |
| `ENCRYPTION_KEY` | generated | A base64 32-byte key (`openssl rand -base64 32`). Normally leave it unset; see [Data & backups](#data--backups). |
| `ADMIN_PASSWORD_HASH` | unset | A scrypt hash that overrides the password chosen in the UI. See [Forgot your password](#forgot-your-password). |
| `RESET_ADMIN_PASSWORD` | `false` | `true` for one start clears the stored password. See [Forgot your password](#forgot-your-password). |
| `PUID` / `PGID` | `99` / `100` | The user and group the app runs as. The defaults are Unraid's `nobody:users`. The container re-owns `/app/data` to this user at start. |
| `DEFAULT_SYNC_INTERVAL_MINUTES` | `60` | The sync interval used on first boot. You can change it later on the Dashboard. |

There is no `PORT` variable to set. The container always listens on 3000. To use a different port on your network, change the host side of the Port mapping.

Without `PUBLIC_BASE_URL`, login and setup work from loopback and private LAN addresses only (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Tailscale addresses (100.64.0.0/10) and IPv6 unique-local addresses are refused, so set an `https://` `PUBLIC_BASE_URL` for those. With an `https://` address, login is accepted over HTTPS only (see below). Always open the app at the address you registered with MAL and AniList; the OAuth login flow depends on it.

The SQLite database lives at `/mnt/user/appdata/mal-sync-docker/malsync.db` on the host, so it survives container updates and recreation.

If `ghcr.io/sweevee1/mal-sync-docker:latest` fails to pull with a permission or authentication error, the GHCR package may still be private. No login is needed once it is public; this is a one-time setting on the GitHub side.

## Making it public with Cloudflare Tunnel

Use this if you want to reach the app from outside your home network. The tunnel makes an outbound connection from your server to Cloudflare, so you open no inbound ports.

What the login protects: your MAL, AniList, and Kitsu connections and everything the sync can change on them. Without the login, anyone who found the URL could trigger syncs, confirm deletions, or disconnect services.

1. Create a Docker network with a fixed subnet that only this app and `cloudflared` will use. In Unraid's Terminal:
   ```sh
   docker network create --subnet 172.30.0.0/24 --gateway 172.30.0.1 malsync-net
   ```
2. Set the `mal-sync-docker` container's Network Type to `Custom: malsync-net`. Keep the name `mal-sync-docker`; the tunnel uses it as a hostname.
3. In the Cloudflare dashboard, create a tunnel (Zero Trust, Networks, Tunnels) and copy its token. Run `cloudflared` on the same network:
   ```sh
   docker run -d --name cloudflared --restart unless-stopped --network malsync-net cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <YOUR_TUNNEL_TOKEN>
   ```
4. In the tunnel's **Public Hostname** settings, add your hostname (for example `malsync.example.com`) with service type `HTTP` and URL `http://mal-sync-docker:3000`.
5. Set these variables on the `mal-sync-docker` container, then apply:

   | Variable | Value |
   |---|---|
   | `PUBLIC_BASE_URL` | `https://malsync.example.com` (your hostname) |
   | `TRUST_PROXY` | `true` |
   | `TRUST_PROXY_CIDRS` | `172.30.0.0/24` (the subnet from step 1) |

6. Update the redirect URIs in your MAL and AniList developer settings to `https://malsync.example.com/api/auth/mal/callback` and `https://malsync.example.com/api/auth/anilist/callback`.

Rules to keep this safe:

- Do not port-forward port 3000 on your router, and do not expose it to the internet any other way. The tunnel is the only public path.
- Keep only this app and `cloudflared` on `malsync-net`. Any container in `TRUST_PROXY_CIDRS` can set the forwarded headers the app trusts.
- With an `https://` `PUBLIC_BASE_URL`, login is accepted only over HTTPS. Use the `https://` hostname even from inside your LAN. Logging in at `http://<unraid-ip>:3000` is rejected on purpose, so a password is never sent in plain text on a public deployment.
- Optional extra layer: put a Cloudflare Access policy on the hostname so Cloudflare asks for your identity before requests reach the app. The OAuth redirects from MAL and AniList go through your own browser, so they work while you are signed in to Access in that browser.

What the app does on its side:

- The password is stored only as a scrypt hash, in the database (or in `ADMIN_PASSWORD_HASH` if you set that).
- Sessions are stored server-side as SHA-256 hashes of the cookie token. The cookie is `HttpOnly` and `SameSite=Strict`, and is `Secure` with the `__Host-` prefix when `PUBLIC_BASE_URL` is `https://`. A session lasts at most 30 days and expires after 7 days without use.
- After 5 failed logins from one IP within 15 minutes, further attempts from that IP get HTTP 429 until the window passes.
- Every request that changes data needs a matching `Origin` header and a custom request header, on top of the `SameSite=Strict` cookie.
- A strict Content-Security-Policy only allows scripts, styles, and requests from the app's own origin.
- The app process always runs as uid 99 (or your `PUID`), not root. The Docker Compose file also drops every Linux capability except the six the entrypoint needs. On Unraid you can get the same by adding this to the container's **Extra Parameters**:
  ```
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID --cap-add KILL --security-opt no-new-privileges:true
  ```

To change your password, use the **Password** card on the **Connect Services** page. Every other browser is signed out. If you set `ADMIN_PASSWORD_HASH`, that variable takes priority and the card is read-only; remove the variable and restart first (your current password keeps working).

### Forgot your password

Add the variable `RESET_ADMIN_PASSWORD=true` to the container and restart it. That start clears the stored password and every session, and the log prints a new setup code. Open the web UI, set a new password, then **remove the variable** so the next restart does not clear it again. If you set `ADMIN_PASSWORD_HASH`, remove it too, since it would otherwise still win.

You can also generate a hash yourself and set it as `ADMIN_PASSWORD_HASH`. The password is read from stdin, so it never appears in the process list or shell history:

```sh
docker run --rm -i --entrypoint node ghcr.io/sweevee1/mal-sync-docker:latest dist/tools/hashPassword.js
```

Type your password, press Enter, then press Ctrl+D. It prints one line starting with `scrypt:`. Paste it as is; it contains colons, so do not edit or quote it.

## Installing anywhere else with Docker Compose

```sh
git clone https://github.com/Sweevee1/mal-sync-docker.git
cd mal-sync-docker
cp .env.example .env
```

Nothing in `.env` is required. Start the stack, read the setup code from `docker compose logs`, and set your password in the browser (steps 3 to 6 of the Unraid instructions above).

Variables in `.env` (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_BASE_URL` | unset | The exact URL you browse to, no path. Required behind a tunnel, a reverse proxy, or over `https://`. `.env.example` leaves it commented out. |
| `TRUST_PROXY` | `false` | `true` only if a reverse proxy sits in front. |
| `TRUST_PROXY_CIDRS` | `loopback` | Proxy IPs or subnets. Only used when `TRUST_PROXY=true`. |
| `ENCRYPTION_KEY` | generated | Encrypts stored tokens. Normally leave it unset; never change it after first use. |
| `ADMIN_PASSWORD_HASH` | unset | A scrypt hash that overrides the password chosen in the UI. |
| `RESET_ADMIN_PASSWORD` | `false` | `true` for one start clears the stored password. |
| `PUID` / `PGID` | `99` / `100` | User and group the app runs as. |
| `DEFAULT_SYNC_INTERVAL_MINUTES` | `60` | Sync interval used on first boot. |
| `HOST_PORT` | `3000` | Host port that maps to the container's port 3000. Read by `docker-compose.yml` itself. |

Leave `DATABASE_URL` in `.env.example` as it is; it already holds the correct path inside the data volume. The `PORT` value is ignored, because the compose file forces the container port to 3000.

The compose file binds the port to `127.0.0.1` only, so the app is reachable from the Docker host itself and from a reverse proxy or tunnel on that host. To reach it from other machines on your LAN, change the `ports` line in `docker-compose.yml` deliberately; set `PUBLIC_BASE_URL` to match if you use a hostname or a proxy.

Then start it:

```sh
docker compose up --build
```

Open the web UI, set your password, and continue from step 5 of the Unraid instructions above.

## Getting Your API Credentials

MyAnimeList and AniList each require you to register a small OAuth app on their own site and give this app the resulting Client ID (and, for AniList, Client Secret). Both are entered on the **Connect Services** page in the UI, not `.env`, and the secret is encrypted at rest the same way tokens are.

The redirect URI you register is the app's base address plus the callback path. With `PUBLIC_BASE_URL` set, it is always that value and never taken from your browser. Without it, the app uses the address you browse to, but only for local and private LAN connections. Either way, **Connect Services** shows the exact value to register, and it must match exactly.

### MyAnimeList
1. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) and create a new client.
2. App Type: `other`. No client secret is required; this app authenticates via PKCE.
3. Register the redirect URI shown on the **Connect Services** page, for example `http://localhost:3000/api/auth/mal/callback`.
4. Paste the client ID into the Client ID field on that page and save.

### AniList
1. Go to [anilist.co/settings/developer](https://anilist.co/settings/developer) and create a new client.
2. Register the redirect URI shown on the **Connect Services** page, for example `http://localhost:3000/api/auth/anilist/callback`.
3. Paste the client ID and secret into the fields on that page and save.
4. Before connecting, set your AniList account's scoring format to **Point (10)** at [anilist.co/settings](https://anilist.co/settings). This app pushes MAL's 0-10 scores through as-is, without converting between scoring formats.

### Kitsu
No app registration needed. On the **Connect Services** page you have two options:

- **Local login**: type your Kitsu username and password in; they stay in your browser and only fill in a `curl` command shown on the page. You run that command yourself, directly against Kitsu's HTTPS endpoint, then paste the resulting `access_token` and `refresh_token` into the app. Your password never touches this server, so this works whether the app is on HTTP or HTTPS. Trade-off: without a stored password, the app can't redo the password grant if the refresh token stops working, so you need to paste a fresh token when that happens.
- **Password (HTTPS)**: the app performs an OAuth2 password grant on your behalf. Your password is stored encrypted at rest (`ENCRYPTION_KEY`) and is only used again to re-authenticate if a token refresh fails. **This method is only available over HTTPS.** If the app sees a plain HTTP connection, this tab's fields are disabled and the server rejects the request even if called directly, since it would otherwise send your password in the clear. To enable it, put the app behind a reverse proxy that terminates HTTPS and set `TRUST_PROXY=true` (see below).

#### `TRUST_PROXY`

By default (`TRUST_PROXY=false`), the app only counts a connection as HTTPS if it is literally an HTTPS connection to the app itself. That never happens in the default Docker setup, because the container only speaks plain HTTP.

If a reverse proxy that terminates HTTPS sits in front (Caddy, nginx, Traefik, Cloudflare Tunnel, and so on), set `TRUST_PROXY=true` so the app trusts the proxy's `X-Forwarded-Proto` header. That unlocks Kitsu password login, and it is required for login to work at all when `PUBLIC_BASE_URL` is `https://`.

The app only trusts those headers from the addresses in `TRUST_PROXY_CIDRS`. The default is `loopback`, which does not include a proxy running in another container, so set it to your proxy's own address or subnet. Nothing else can send those headers.

**Only enable `TRUST_PROXY` if a reverse proxy actually sits in front of the app.** If the container's port is exposed directly, a client could forge the header to fake HTTPS and defeat the protection.

#### Finding the proxy address

Use the container name of your proxy (`cloudflared` in the example above):

```sh
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' cloudflared
docker network inspect malsync-net -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

The first command prints the proxy's IP on each network it is attached to. The second prints the subnet of a network. Use either the single IP or the subnet as `TRUST_PROXY_CIDRS`. A fixed subnet like `172.30.0.0/24` stays valid when the proxy container is recreated and gets a new IP; a single IP does not.

## How syncing works

- MAL's anime and manga lists are the source of truth. Nothing is ever read back from AniList or Kitsu to modify MAL.
- A background job runs every `syncIntervalMinutes` (configurable on the Dashboard); you can also trigger a sync manually.
- Every ~24 hours, a sync does a **full pass** over your entire MAL list (rather than just recently-changed entries) to detect removals. If a title is missing from your MAL list, it's flagged as **pending removal** in the Library view. Nothing is deleted from AniList or Kitsu automatically; you confirm each removal explicitly.
- Titles that can't be matched between services (for example very obscure releases) are logged as "no match" and skipped without failing the rest of the sync.
- AniList scores are pushed as a direct 0-10 passthrough, so make sure your AniList account uses Point (10) scoring (see above).

## Development

```sh
npm install
npm run dev:backend    # backend on :3000
npm run dev:frontend   # vite dev server on :5173, proxies /api to :3000
npm test -w backend    # backend test suite
```

Create `backend/.env` from `.env.example`. Beyond the usual variables it needs:

- `DATABASE_URL`, local and relative, for example `file:./prisma/dev.db`. If you get "Unable to open the database file", try an absolute `file:` path.
- Optionally `ADMIN_PASSWORD_HASH`, generated with `npm run hash-password -w backend` (type your password, press Enter, then Ctrl+D). Without it, set a password in the browser using the setup code printed in the backend log.
- `PUBLIC_BASE_URL=http://localhost:5173`, since you browse the Vite dev server (the Vite proxy makes requests arrive with a different Host, so set the address explicitly). MAL and AniList redirect URIs in dev then look like `http://localhost:5173/api/auth/mal/callback`.

Run migrations with:

```sh
npm run prisma:migrate
```

## Data & backups

All state (credentials, cached list data, sync history, login sessions) lives in a single SQLite file at `/app/data/malsync.db` inside the container. That is the Unraid path mapping above, or the `malsync-data` Docker volume if you use `docker compose`.

The app keeps its encryption key in `encryption.key` in the same data folder (mode 600). It is generated on first start, or copied from `ENCRYPTION_KEY` if you set that variable, so removing the variable later keeps the same key.

Back up the whole data folder (`/mnt/user/appdata/mal-sync-docker` on Unraid): it holds `malsync.db` and `encryption.key`, and you need both. The database without the key holds tokens you cannot decrypt, so you would have to reconnect every service.

The trade-off: the key now sits beside the database, so anyone who can read a backup of that folder can read your stored service tokens (and your Kitsu password, if you used password login). Keep the backups as private as the folder itself.

You do not need to back up a password hash; if you lose the password, see [Forgot your password](#forgot-your-password).
