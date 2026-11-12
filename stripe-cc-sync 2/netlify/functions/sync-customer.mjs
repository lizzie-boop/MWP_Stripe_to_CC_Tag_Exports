// Manually sync one customer — for testing and for the backfill script.
// POST /sync-customer  { "customer": "cus_123" }   header: x-setup-key: SETUP_KEY

import { config as settings } from "../../lib/config.mjs";
import { syncCustomer } from "../../lib/sync.mjs";

export default async (req) => {
  if (req.headers.get("x-setup-key") !== settings.setupKey()) return new Response("Not found", { status: 404 });

  const { customer } = await req.json().catch(() => ({}));
  if (!customer?.startsWith("cus_")) return new Response('Send {"customer":"cus_..."}', { status: 400 });

  try {
    return Response.json(await syncCustomer(customer));
  } catch (e) {
    return Response.json({ customer, error: e.message }, { status: 500 });
  }
};

export const config = { path: "/sync-customer" };
