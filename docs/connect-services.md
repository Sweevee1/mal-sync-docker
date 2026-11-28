# Getting Your API Credentials

On the **Connect Services** page, register a small OAuth app with MyAnimeList and AniList and paste the result in. The page shows the exact redirect URI to register, such as `http://YOUR-SERVER-IP:3000/api/auth/mal/callback`, and it must match exactly. Open the app at that same address when you connect.

- **MyAnimeList:** at [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig), create a client with App Type `other` and no secret. Paste the Client ID.
- **AniList:** at [anilist.co/settings/developer](https://anilist.co/settings/developer), create a client and paste the Client ID and Secret. First set your AniList scoring format to **Point (10)**, because MAL scores are passed through as they are.
- **Kitsu:** no app needed. **Local login** builds a `curl` command for you; run it yourself and paste back the tokens. Your password never touches the server, and it works over HTTP, but you must paste fresh tokens when the refresh token stops working. **Password (HTTPS)** logs in for you and stores the password encrypted to renew tokens itself, but it needs HTTPS (see the [tunnel guide](cloudflare-tunnel.md)).
