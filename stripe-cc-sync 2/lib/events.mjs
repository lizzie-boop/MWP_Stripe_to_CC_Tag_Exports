// Which Stripe events can change a customer's billing status.
// Everything else (including the subscription.updated that fires on EVERY renewal)
// is ignored, so the function does no Constant Contact work for routine billing.

export const EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.payment_failed",
];

const STATUS_FIELDS = ["status", "cancel_at_period_end", "cancel_at", "pause_collection"];

export function isRelevant(event) {
  if (!EVENT_TYPES.includes(event.type)) return false;
  if (event.type !== "customer.subscription.updated") return true;
  const prev = event.data?.previous_attributes || {};
  return STATUS_FIELDS.some((k) => k in prev);
}

export function customerIdOf(event) {
  const c = event.data?.object?.customer;
  return typeof c === "string" ? c : c?.id || null;
}
