# Access from Outside Your Home

Use a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). It connects outward from your server, so never port-forward port 3000.

1. In Unraid's Terminal, create a network, then set the container's Network Type to `Custom: malsync-net` (keep the container name `mal-sync-docker`, since step 3 uses it as the hostname):
   ```bash
   docker network create --subnet 172.30.0.0/24 --gateway 172.30.0.1 malsync-net
   ```
2. In Cloudflare (Zero Trust, Networks, Tunnels), create a tunnel, copy its token, and run `cloudflared` on that network:
   ```bash
   docker run -d --name cloudflared --restart unless-stopped --network malsync-net cloudflare/cloudflared:latest tunnel --no-autoupdate run --token YOUR_TUNNEL_TOKEN
   ```
3. Add a **Public Hostname** such as `malsync.example.com`, with service `HTTP` and URL `http://mal-sync-docker:3000`.
4. Add these variables to the container and apply: `PUBLIC_BASE_URL=https://malsync.example.com`, `TRUST_PROXY=true`, `TRUST_PROXY_CIDRS=172.30.0.0/24`.
5. Change your MAL and AniList redirect URIs to `https://malsync.example.com/api/auth/mal/callback` and `https://malsync.example.com/api/auth/anilist/callback`.

Keep only this app and `cloudflared` on `malsync-net`, and log in at the `https://` address only. This also unlocks Kitsu **Password (HTTPS)**.
