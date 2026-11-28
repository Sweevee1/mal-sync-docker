# Configuration

## Environment Variables

All optional. On Unraid, add them as container **Variables**; with Compose, use `.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | unset | The exact URL you browse to, no path. Needed for any `https://` or tunnel setup. |
| `TRUST_PROXY` | `false` | `true` only when a reverse proxy sits in front. Never set it if the port is exposed directly. |
| `TRUST_PROXY_CIDRS` | `loopback` | Proxy IPs or subnets to trust. Used only when `TRUST_PROXY=true`. |
| `ENCRYPTION_KEY` | generated | Normally leave unset, and never change it after first use. |
| `ADMIN_PASSWORD_HASH` | unset | A scrypt hash that overrides the password chosen in the browser. |
| `RESET_ADMIN_PASSWORD` | `false` | `true` for one start clears the stored password. |
| `PUID` / `PGID` | `99` / `100` | User and group the app runs as (Unraid's `nobody:users`). |
| `DEFAULT_SYNC_INTERVAL_MINUTES` | `60` | Sync interval on first boot. |
| `HOST_PORT` | `3000` | Compose only. The host port mapped to the container's port 3000. |

Do not set `PORT`. The container always listens on 3000, so change the host side of the port mapping instead. With Compose, leave `DATABASE_URL` in `.env.example` as it is, and set `PUBLIC_BASE_URL` to match if you use a hostname or a proxy.

Unless `PUBLIC_BASE_URL` is `https://`, login and setup work only from loopback and private LAN addresses (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Tailscale addresses (100.64.0.0/10) are refused, so use an `https://` `PUBLIC_BASE_URL` for those. Always open the app at the address you registered with MAL and AniList.

**Upgrading from an earlier version:** existing `ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH` and `PUBLIC_BASE_URL` values keep working. The first start copies the key and hash into the data folder, so you can remove those two variables afterward. If you connected MAL or AniList before, recheck their redirect URIs against the **Connect Services** page.

## Reverse Proxy and Hardening

- Set `TRUST_PROXY=true` only when a reverse proxy that terminates HTTPS (Caddy, nginx, Traefik, Cloudflare Tunnel) sits in front, and list its address or subnet in `TRUST_PROXY_CIDRS`. The app only trusts forwarded headers from those addresses. To find a proxy container's IP: `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' <container>`. A fixed subnet stays valid when the container is recreated; a single IP does not.
- Optionally put a Cloudflare Access policy on the tunnel hostname for an extra layer.
- The Compose file already drops every Linux capability except the six the entrypoint needs. On Unraid, add this to the container's **Extra Parameters**:

  ```
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID --cap-add KILL --security-opt no-new-privileges:true
  ```

## Passwords

Change your password from the **Password** card on the **Connect Services** page. If `ADMIN_PASSWORD_HASH` is set, it takes priority and the card is read-only until you remove the variable and restart. Until you finish first-time setup, the setup code in the log changes on every start.

**Forgot it?** Add `RESET_ADMIN_PASSWORD=true` and restart. Set a new password with the new setup code in the log, then **remove the variable** (and `ADMIN_PASSWORD_HASH` if set).

To make a hash for `ADMIN_PASSWORD_HASH`, run this, type the password, press Enter, then press Ctrl+D (Ctrl+Z then Enter on Windows). It prints one line starting with `scrypt:`; paste it as is, without editing or quoting it, since it contains colons:

```bash
docker run --rm -i --entrypoint node ghcr.io/sweevee1/mal-sync-docker:latest dist/tools/hashPassword.js
```

## Data & Backups

Back up the whole data folder (`/mnt/user/appdata/mal-sync-docker`, or the `malsync-data` volume). It holds `malsync.db` and `encryption.key`, and you need both. The key sits beside the database, so keep backups private. You do not need to back up a password hash.

## Troubleshooting

If the image fails to pull with a permission or authentication error, the GHCR package is still private. It needs to be made public once in the package's GitHub settings.
