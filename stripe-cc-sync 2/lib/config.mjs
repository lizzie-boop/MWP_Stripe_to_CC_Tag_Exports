// All settings come from Netlify environment variables. See README.md.

const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${name}`);
  }
  return v;
};

export const config = {
  stripeSecretKey: () => env("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => env("STRIPE_WEBHOOK_SECRET"),

  ccClientId: () => env("CC_CLIENT_ID"),
  ccClientSecret: () => env("CC_CLIENT_SECRET"),
  ccRefreshTokenSeed: () => process.env.CC_REFRESH_TOKEN || null,

  setupKey: () => env("SETUP_KEY"),

  // Tag names in Constant Contact, one per status. Created automatically if missing.
  tagNames: () => ({
    active: env("TAG_ACTIVE", "Stripe: Active"),
    payment_failed: env("TAG_PAYMENT_FAILED", "Stripe: Payment Failed"),
    cancel_scheduled: env("TAG_CANCEL_SCHEDULED", "Stripe: Cancel Scheduled"),
    canceled: env("TAG_CANCELED", "Stripe: Canceled"),
  }),

  // Optional lists. Each entry: a Constant Contact list ID and the statuses that belong on it.
  // A contact is added when their status matches and removed when it stops matching.
  // Use these as "Added to specific list" automation triggers.
  statusLists: () => {
    const lists = [];
    const one = (envName, statuses) => {
      const id = process.env[envName];
      if (id) lists.push({ name: envName, listId: id.trim(), statuses });
    };
    one("CC_LIST_ACTIVE", ["active"]);
    one("CC_LIST_PAYMENT_FAILED", ["payment_failed"]);
    one("CC_LIST_CANCEL_SCHEDULED", ["cancel_scheduled"]);
    one("CC_LIST_CANCELED", ["canceled"]);
    // Combined list, e.g. one "Reactivation" list for failed + canceled.
    one("CC_REACTIVATION_LIST_ID",
      env("REACTIVATION_STATUSES", "payment_failed,canceled").split(",").map((s) => s.trim()));
    return lists;
  },

  createMissingContacts: () => env("CREATE_MISSING_CONTACTS", "true") === "true",
};
