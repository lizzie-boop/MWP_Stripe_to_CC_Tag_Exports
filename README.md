# Stripe → Constant Contact status sync (Netlify)

When a customer's subscription status changes in Stripe, this updates their Constant Contact record within seconds. It applies one status tag and moves the contact onto the matching list, taking them off any lists that no longer apply. Those lists are what start your Constant Contact automations.

| Status | Tag (default) | List variable | When |
|---|---|---|---|
| `active` | Stripe: Active | `CC_LIST_ACTIVE` | Paying or trialing, no cancellation scheduled |
| `payment_failed` | Stripe: Payment Failed | `CC_LIST_PAYMENT_FAILED` | Renewal failed: `past_due`, `unpaid`, or `paused` (trial ended without a card) |
| `cancel_scheduled` | Stripe: Cancel Scheduled | `CC_LIST_CANCEL_SCHEDULED` | Still active but set to cancel |
| `canceled` | Stripe: Canceled | `CC_LIST_CANCELED` | No live subscription left, and had one before |
| failed or canceled | none | `CC_REACTIVATION_LIST_ID` | Optional combined list; set which statuses with `REACTIVATION_STATUSES` |

Every list is optional. Set only the ones you'll use. The sync only touches lists you configure, so lists created by Constant Contact's native Stripe integration, and any others, are left alone. The native integration can keep running alongside this.

## How it stays efficient
- **It ignores renewal noise.** Stripe sends a subscription update on every renewal. The webhook only acts when the status, the scheduled cancellation, or a pause actually changes. Anything else gets an immediate 200 with no API calls.
- **One Stripe call per sync.** It fetches the customer's subscriptions with the customer record embedded.
- **No writes when nothing changed.** It reads the contact's current tags and lists first and only sends changes.
- **Constant Contact access tokens and tag IDs are cached** in Netlify Blobs.

## How it stays accurate
- **It reads Stripe's current state.** It doesn't trust the event payload, so events that arrive out of order can't leave a stale tag. A customer who cancels one subscription but still has another isn't marked canceled.
- **Stripe retries failed deliveries.** If Constant Contact is down, the function returns a 500 and Stripe retries for up to three days.
- **A daily catch-up job** replays the last 26 hours of status-changing events and fixes anything that drifted. Its summary appears in the Netlify function logs.

## Setup

1. **Deploy.** Push this folder to GitHub and create a Netlify site from it. There's no build step.
2. **Create a Constant Contact API app.** Do this at developer.constantcontact.com under My Applications. Set the redirect URI to `https://YOUR-SITE.netlify.app/cc-oauth`. Choose **Long Lived** refresh tokens. Copy the client ID and generate a secret.
3. **Create the lists** in Constant Contact (for example "Payment Failed" and "Canceled"). To find a list's ID, open the list; the ID is the `listId=` value in the page URL.
4. **Set the Netlify environment variables:**

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | A restricted key with **read** access to Customers, Subscriptions and Events |
| `STRIPE_WEBHOOK_SECRET` | From step 6 (`whsec_...`) |
| `CC_CLIENT_ID` / `CC_CLIENT_SECRET` | From step 2 |
| `SETUP_KEY` | Any long random string |
| `CC_LIST_*` / `CC_REACTIVATION_LIST_ID` | List IDs from step 3 (all optional) |
| `REACTIVATION_STATUSES` | Optional. Defaults to `payment_failed,canceled` |
| `TAG_ACTIVE`, `TAG_PAYMENT_FAILED`, `TAG_CANCEL_SCHEDULED`, `TAG_CANCELED` | Optional custom tag names |
| `CREATE_MISSING_CONTACTS` | Defaults to `true`. Set to `false` if the native Stripe integration already imports your customers |

5. **Connect Constant Contact once.** Visit `https://YOUR-SITE.netlify.app/cc-oauth?key=YOUR_SETUP_KEY` and approve the access.
6. **Add the Stripe webhook.** In Stripe go to Developers → Webhooks and add the endpoint `https://YOUR-SITE.netlify.app/stripe-webhook`. Select these events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, and `invoice.payment_failed`. Paste the signing secret into Netlify and redeploy.
7. **Build the automations.** In Constant Contact, create a custom path for each list with the **Added to specific list** trigger. Add a stop or exit rule so a contact who leaves the list, or gets the Stripe: Active tag, stops receiving emails.
8. **Test one customer, then backfill:**
```
curl -X POST https://YOUR-SITE.netlify.app/sync-customer \
  -H "x-setup-key: YOUR_SETUP_KEY" -H "Content-Type: application/json" \
  -d '{"customer":"cus_..."}'

STRIPE_SECRET_KEY=sk_live_... SITE_URL=https://YOUR-SITE.netlify.app SETUP_KEY=... node scripts/backfill.mjs          # dry run
STRIPE_SECRET_KEY=sk_live_... SITE_URL=https://YOUR-SITE.netlify.app SETUP_KEY=... node scripts/backfill.mjs --apply
```
The backfill puts past cancellations on your lists. If those lists start automations, anyone who churned long ago would get a win-back email. To avoid that, run the backfill **before** you activate the automation paths.

## Things to know
- **Matching is by email**, lowercased. Stripe customers without an email are skipped.
- **Email permission isn't changed for existing contacts.** Missing contacts are created with `implicit` permission, meaning an existing customer relationship, never as fresh opt-ins. Unsubscribed contacts still get tagged, but Constant Contact won't email them.
- **Contacts deleted in Constant Contact are not recreated.**
- **Only subscription billing is tracked.** Failed one-off invoices aren't.
- `npm test` runs the test suite with Stripe and Constant Contact faked.
