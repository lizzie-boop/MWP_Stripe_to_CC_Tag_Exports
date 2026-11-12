// Tag everyone who ALREADY failed or canceled before the webhook existed.
// Run from your laptop after deploying:
//
//   STRIPE_SECRET_KEY=sk_live_... SITE_URL=https://your-site.netlify.app SETUP_KEY=... \
//     node scripts/backfill.mjs            # dry run: lists who would be synced
//     node scripts/backfill.mjs --apply    # actually sync them
//
// Only customers who have had at least one subscription are sent.

import Stripe from "stripe";

const { STRIPE_SECRET_KEY, SITE_URL, SETUP_KEY } = process.env;
if (!STRIPE_SECRET_KEY || !SITE_URL || !SETUP_KEY) {
  console.error("Set STRIPE_SECRET_KEY, SITE_URL and SETUP_KEY");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const stripe = new Stripe(STRIPE_SECRET_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set();
const counts = {};

for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
  const id = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (seen.has(id)) continue;
  seen.add(id);

  if (!apply) { console.log("would sync", id); continue; }

  const res = await fetch(`${SITE_URL.replace(/\/$/, "")}/sync-customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-setup-key": SETUP_KEY },
    body: JSON.stringify({ customer: id }),
  });
  const out = await res.json().catch(() => ({ error: res.statusText }));
  const key = out.error ? "error" : out.skipped ? "skipped" : out.status;
  counts[key] = (counts[key] || 0) + 1;
  console.log(id, JSON.stringify(out));

  await sleep(400); // stay well under Constant Contact's rate limits
}

console.log(`\n${seen.size} customers ${apply ? "synced" : "found (dry run)"}`, apply ? counts : "");
