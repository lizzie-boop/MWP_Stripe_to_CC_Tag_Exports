// The core: make one Stripe customer's Constant Contact tags match their billing status.

import Stripe from "stripe";
import { config } from "./config.mjs";
import { deriveStatus, STATUSES } from "./status.mjs";
import * as CC from "./constant-contact.mjs";

let _stripe;
export const stripe = () => (_stripe ||= new Stripe(config.stripeSecretKey()));

// One Stripe call: all of the customer's subscriptions, with the customer record embedded.
async function allSubscriptions(customerId) {
  const subs = [];
  const params = { customer: customerId, status: "all", limit: 100, expand: ["data.customer"] };
  for await (const s of stripe().subscriptions.list(params)) subs.push(s);
  return subs;
}

function splitName(name) {
  if (!name) return {};
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
}

export async function syncCustomer(customerId) {
  const subs = await allSubscriptions(customerId);
  const status = deriveStatus(subs);
  if (!status) return { customerId, skipped: "no paid subscription history" };

  const customer = subs[0].customer;
  if (!customer || customer.deleted) return { customerId, skipped: "customer deleted in Stripe" };
  if (!customer.email) return { customerId, skipped: "customer has no email" };
  const email = customer.email.trim().toLowerCase();

  let contact = await CC.findContact(email);
  if (contact?.deleted_at) return { customerId, email, status, skipped: "contact was deleted in Constant Contact" };
  if (!contact) {
    if (!config.createMissingContacts()) return { customerId, email, status, skipped: "not in Constant Contact" };
    contact = await CC.createContact({ email, ...splitName(customer.name) });
    contact.taggings = [];
    contact.list_memberships = [];
  }

  const tagNames = config.tagNames();
  let tagIds = await CC.ensureTags(tagNames);

  const has = new Set(contact.taggings || []);
  const want = tagIds[status];
  const toRemove = STATUSES.filter((s) => s !== status).map((s) => tagIds[s]).filter((id) => has.has(id));
  const toAdd = has.has(want) ? [] : [want];

  try {
    await CC.addTags(contact.contact_id, toAdd);
  } catch (e) {
    // Someone deleted/renamed a tag in the UI: rebuild the cache once and retry.
    if (e.status !== 400 && e.status !== 404) throw e;
    await CC.forgetTagCache(tagNames);
    tagIds = await CC.ensureTags(tagNames);
    await CC.addTags(contact.contact_id, [tagIds[status]]);
  }
  await CC.removeTags(contact.contact_id, toRemove);

  // Optional status lists (the reliable automation triggers).
  const memberships = new Set(contact.list_memberships || []);
  const lists = {};
  for (const { name, listId, statuses } of config.statusLists()) {
    const onList = memberships.has(listId);
    const belongs = statuses.includes(status);
    if (belongs && !onList) { await CC.addToList(contact.contact_id, listId); lists[name] = "added"; }
    else if (!belongs && onList) { await CC.removeFromList(contact.contact_id, listId); lists[name] = "removed"; }
    else lists[name] = "unchanged";
  }

  return {
    customerId,
    email,
    status,
    contactId: contact.contact_id,
    tagged: toAdd.length ? tagNames[status] : "already tagged",
    untagged: toRemove.length,
    lists,
  };
}
