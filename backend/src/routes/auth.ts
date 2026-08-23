import { Router } from "express";
import * as mal from "../services/mal";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";

export const authRouter = Router();

authRouter.get("/mal/start", async (_req, res) => {
  const url = await mal.startAuth();
  res.redirect(url);
});

authRouter.get("/mal/callback", async (req, res) => {
  const { code, state } = req.query;
  try {
    await mal.handleCallback(String(code), String(state));
    res.redirect("/?connected=mal");
  } catch (err: any) {
    res.redirect(`/?error=${encodeURIComponent(err?.message ?? "MAL connection failed")}`);
  }
});

authRouter.get("/anilist/start", async (_req, res) => {
  const url = await anilist.startAuth();
  res.redirect(url);
});

authRouter.get("/anilist/callback", async (req, res) => {
  const { code, state } = req.query;
  try {
    await anilist.handleCallback(String(code), String(state));
    res.redirect("/?connected=anilist");
  } catch (err: any) {
    res.redirect(`/?error=${encodeURIComponent(err?.message ?? "AniList connection failed")}`);
  }
});

authRouter.post("/kitsu", async (req, res) => {
  if (!req.secure) {
    return res.status(403).json({
      error:
        "Kitsu password login is disabled because this connection isn't HTTPS. Use the 'Paste a token' method " +
        "instead, or put this app behind an HTTPS reverse proxy and set TRUST_PROXY=true to enable it.",
    });
  }
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  try {
    await kitsu.connect(username, password);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.response?.data?.error_description ?? err?.message ?? "Kitsu connection failed" });
  }
});

authRouter.post("/kitsu/token", async (req, res) => {
  const { accessToken, refreshToken, expiresInSeconds } = req.body ?? {};
  if (!accessToken || typeof accessToken !== "string") {
    return res.status(400).json({ error: "accessToken is required" });
  }
  try {
    await kitsu.connectWithToken(
      accessToken,
      typeof refreshToken === "string" && refreshToken ? refreshToken : null,
      typeof expiresInSeconds === "number" && expiresInSeconds > 0 ? expiresInSeconds : null
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.response?.data?.error_description ?? err?.message ?? "Kitsu connection failed" });
  }
});

authRouter.delete("/:service", async (req, res) => {
  const service = String(req.params.service).toUpperCase();
  switch (service) {
    case "MAL":
      await mal.disconnect();
      break;
    case "ANILIST":
      await anilist.disconnect();
      break;
    case "KITSU":
      await kitsu.disconnect();
      break;
    default:
      return res.status(400).json({ error: "Unknown service" });
  }
  res.json({ ok: true });
});
