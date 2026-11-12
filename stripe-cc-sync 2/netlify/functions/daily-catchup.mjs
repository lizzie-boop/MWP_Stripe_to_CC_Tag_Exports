// Safety net. Once a day, replays the last 26 hours of status-changing Stripe events
// and resyncs those customers. Catches anything a webhook missed (Constant Contact
// outage, a token problem, a deploy at the wrong moment). Already-correct contacts
// cost one lookup and no writes.

import { stripe, syncCustomer } from "../../lib/sync.mjs";
import { EVENT_TYPES, isRelevant, customerIdOf } from "../../lib/events.mjs";

const LOOKBACK_SECONDS = 26 * 60 * 60;
const TIME_BUDGET_MS = 25_000; // scheduled functions get ~30s
const CONCURRENCY = 3;

export default async () => {
  const started = Date.now();
  const since = Math.floor(started / 1000) - LOOKBACK_SECONDS;

  const customers = new Set();
  for await (const ev of stripe().events.list({ types: EVENT_TYPES, created: { gte: since }, limit: 100 })) {
    if (isRelevant(ev)) {
      const id = customerIdOf(ev);
      if (id) customers.add(id);
    }
  }

  const queue = [...customers];
  const tally = { synced: 0, changed: 0, skipped: 0, failed: 0, notReached: 0 };

  async function worker() {
    while (queue.length) {
      if (Date.now() - started > TIME_BUDGET_MS) { tally.notReached = queue.length; queue.length = 0; return; }
      const id = queue.shift();
      try {
        const r = await syncCustomer(id);
        if (r.skipped) tally.skipped++;
        else {
          tally.synced++;
          const listChange = Object.values(r.lists || {}).some((v) => v !== "unchanged");
          if (r.tagged !== "already tagged" || r.untagged || listChange) {
            tally.changed++;
            console.log("catch-up fixed", JSON.stringify(r));
          }
        }
      } catch (e) {
        tally.failed++;
        console.error("catch-up failed", id, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("daily catch-up", JSON.stringify({ customers: customers.size, ...tally }));
};

export const config = { schedule: "@daily" };
