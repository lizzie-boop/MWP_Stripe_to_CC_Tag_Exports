// Keeps a valid Constant Contact access token.
// Tokens live in Netlify Blobs so a rotated refresh token survives between calls.

import { getStore } from "@netlify/blobs";
import { config } from "./config.mjs";

export const AUTHORIZE_URL = "https://authz.constantcontact.com/oauth2/default/v1/authorize";
export const TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";

// Access tokens last at most 24h; refresh well before that.
const MAX_TOKEN_AGE_MS = 20 * 60 * 60 * 1000;

export const store = () => getStore({ name: "stripe-cc-sync", consistency: "strong" });

function basicAuth() {
  const raw = `${config.ccClientId()}:${config.ccClientSecret()}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}

export async function requestTokens(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Constant Contact token request failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function saveTokens(t) {
  const saved = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    obtained_at: Date.now(),
  };
  await store().setJSON("cc-tokens", saved);
  return saved;
}

export async function getAccessToken({ force = false } = {}) {
  const current = await store().get("cc-tokens", { type: "json" });

  if (!force && current?.access_token && Date.now() - current.obtained_at < MAX_TOKEN_AGE_MS) {
    return current.access_token;
  }

  const refreshToken = current?.refresh_token || config.ccRefreshTokenSeed();
  if (!refreshToken) {
    throw new Error("Constant Contact is not authorized yet. Visit /cc-oauth?key=SETUP_KEY once.");
  }

  const fresh = await requestTokens({ grant_type: "refresh_token", refresh_token: refreshToken });
  // Long-lived refresh tokens come back unchanged; rotating ones come back new.
  if (!fresh.refresh_token) fresh.refresh_token = refreshToken;
  return (await saveTokens(fresh)).access_token;
}
