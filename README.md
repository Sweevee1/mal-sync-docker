# MAL-Sync Docker

A self-hosted tool to sync your MyAnimeList to Anilist and Kitsu.

## Features

- **Scheduled and manual sync** from MyAnimeList to AniList and Kitsu
- **Read-only Check sync and Dry run** to see what differs before anything is pushed
- **Safe removals**: titles removed from MAL show as **pending removal** in the Library, and are only deleted elsewhere after confirmation

## Install on Unraid/Docker

In the Unraid **Docker** tab, click **Add Container**.

| Field | Value |
| --- | --- |
| Name | `mal-sync-docker` |
| Repository | `ghcr.io/sweevee1/mal-sync-docker:latest` |
| Network Type | `Bridge` |
| Port | Container `3000` → Host `3000` |
| Path | Container `/app/data` → Host `/mnt/user/appdata/mal-sync-docker` |

No variables are needed on a home network. To log in from anywhere else, including over Tailscale, you need HTTPS. The [Cloudflare Tunnel guide](docs/cloudflare-tunnel.md) (written for Unraid) sets it up without opening any ports.

1. Apply, then open the container's **Logs** and copy the setup code.
2. Open the web UI at `http://YOUR-SERVER-IP:3000`.
3. Choose a password (at least 12 characters) and enter the setup code.

### Docker Compose

```bash
git clone https://github.com/Sweevee1/mal-sync-docker.git
cd mal-sync-docker
cp .env.example .env   # nothing in it is required
docker compose up -d
```

Read the setup code from `docker compose logs`, then open [http://localhost:3000](http://localhost:3000). The port is bound to `127.0.0.1`; to reach it from other machines, change the `ports` line in `docker-compose.yml`.

## Getting Your API Credentials

MyAnimeList and AniList each need a small OAuth app, which you register on their sites and paste into the **Connect Services** page. Kitsu needs no app. See [Connect Services](docs/connect-services.md) for the steps.

## Syncing

Click a button on the Dashboard, or wait for the scheduled sync (hourly by default, changeable there).

| Button | What it does |
| --- | --- |
| **Sync now** | Pushes changes from MAL to AniList and Kitsu. Entries that already match are left alone. |
| **Check sync** | Compares MAL with every mapped entry on both services. Never writes. Run it first if AniList or Kitsu are already populated. |
| **Dry run** | Shows what a sync would push, without pushing it. |

## More

- [Configuration](docs/configuration.md): environment variables, passwords, reverse proxies, backups, troubleshooting
- [Cloudflare Tunnel](docs/cloudflare-tunnel.md): reach the app from outside your home
- [Development](docs/development.md)
