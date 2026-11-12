// Stripe sends events here. We verify the signature, skip anything that can't change
// billing status, and resync the customer from Stripe's current data.

import { config as settings } from "../../lib/config.mjs";
import { stripe, syncCustomer } from "../../lib/sync.mjs";
import { isRelevant, customerIdOf } from "../../lib/events.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text(); // must be the untouched body for signature checks
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      raw,
      req.headers.get("stripe-signature"),
      settings.stripeWebhookSecret(),
    );
  } catch (e) {
    return new Response(`Bad signature: ${e.message}`, { status: 400 });
  }

  // Routine renewals and unrelated events: acknowledge and stop. No API calls.
  if (!isRelevant(event)) return Response.json({ ignored: event.type });

  const customerId = customerIdOf(event);
  if (!customerId) return Response.json({ ignored: "no customer on event" });

  try {
    const result = await syncCustomer(customerId);
    console.log(event.type, JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    console.error(event.type, customerId, e);
    // A 500 makes Stripe retry with backoff for up to 3 days.
    return new Response(`Sync failed: ${e.message}`, { status: 500 });
  }
};

export const config = { path: "/stripe-webhook" };
