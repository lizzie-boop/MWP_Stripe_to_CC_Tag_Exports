// One-time Constant Contact authorization.
// 1. Visit https://YOUR-SITE/cc-oauth?key=SETUP_KEY
// 2. Log in to Constant Contact and approve.
// 3. You land back here and the tokens are saved. Done.

import crypto from "node:crypto";
import { config as settings } from "../../lib/config.mjs";
import { AUTHORIZE_URL, requestTokens, saveTokens, store } from "../../lib/tokens.mjs";

const page = (msg, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:2rem">${msg}</body>`, {
    status,
    headers: { "Content-Type": "text/html" },
  });

export default async (req) => {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/cc-oauth`;

  // Step 2: Constant Contact sends the user back with ?code=&state=
  if (url.searchParams.has("code")) {
    const expected = await store().get("cc-oauth-state");
    if (!expected || expected !== url.searchParams.get("state")) return page("State mismatch. Start again.", 400);
    await store().delete("cc-oauth-state");

    const tokens = await requestTokens({
      grant_type: "authorization_code",
      code: url.searchParams.get("code"),
      redirect_uri: redirectUri,
    });
    await saveTokens(tokens);
    return page("✅ Constant Contact is connected. You can close this tab.");
  }

  if (url.searchParams.has("error")) {
    return page(`Constant Contact returned an error: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`, 400);
  }

  // Step 1: kick off the login, protected by SETUP_KEY.
  if (url.searchParams.get("key") !== settings.setupKey()) return page("Not found", 404);

  const state = crypto.randomBytes(24).toString("hex");
  await store().set("cc-oauth-state", state);

  const auth = new URL(AUTHORIZE_URL);
  auth.search = new URLSearchParams({
    client_id: settings.ccClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "contact_data offline_access",
    state,
  });
  return Response.redirect(auth.toString(), 302);
};

export const config = { path: "/cc-oauth" };
