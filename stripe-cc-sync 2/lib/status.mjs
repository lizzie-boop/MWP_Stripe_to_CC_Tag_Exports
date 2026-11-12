// Turns a Stripe customer's subscriptions into ONE billing status.
// We always look at the customer's current subscriptions instead of trusting
// the single event that arrived, because Stripe can deliver events out of
// order and a customer can have more than one subscription.

const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
const FAILING = new Set(["past_due", "unpaid", "paused"]); // paused = trial ended with no payment method

export const STATUSES = ["active", "payment_failed", "cancel_scheduled", "canceled"];

export function isCancelScheduled(sub) {
  // Newer Stripe API versions may set cancel_at instead of cancel_at_period_end.
  return Boolean(sub.cancel_at_period_end || sub.cancel_at);
}

/**
 * @param {Array<{status: string, cancel_at_period_end?: boolean, cancel_at?: number|null}>} subs
 * @returns {"active"|"payment_failed"|"cancel_scheduled"|"canceled"|null}
 *   null = nothing to say (e.g. never had a paid subscription); leave tags alone.
 */
export function deriveStatus(subs) {
  const live = subs.filter((s) => LIVE.has(s.status));

  if (live.some((s) => FAILING.has(s.status))) return "payment_failed";
  if (live.some((s) => !isCancelScheduled(s))) return "active";
  if (live.length > 0) return "cancel_scheduled";
  if (subs.some((s) => s.status === "canceled")) return "canceled";
  return null;
}
