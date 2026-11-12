// Small Constant Contact v3 client: just what the sync needs.

import { getAccessToken, store } from "./tokens.mjs";

const API = "https://api.cc.email/v3";

async function cc(method, path, body, retried = false) {
  const token = await getAccessToken({ force: retried });
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !retried) return cc(method, path, body, true);
  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Constant Contact ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- tags ----------

/** Returns { statusKey: tagId }, creating any tags that don't exist yet. Cached in Blobs. */
export async function ensureTags(tagNames) {
  const cacheKey = "cc-tag-ids:" + JSON.stringify(tagNames);
  const cached = await store().get(cacheKey, { type: "json" });
  if (cached) return cached;

  const existing = await cc("GET", "/contact_tags?limit=500");
  const byName = new Map((existing?.tags || []).map((t) => [t.name.toLowerCase(), t.tag_id]));

  const ids = {};
  for (const [status, name] of Object.entries(tagNames)) {
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const created = await cc("POST", "/contact_tags", { name, tag_source: "Stripe" });
      id = created.tag_id;
    }
    ids[status] = id;
  }
  await store().setJSON(cacheKey, ids);
  return ids;
}

export async function forgetTagCache(tagNames) {
  await store().delete("cc-tag-ids:" + JSON.stringify(tagNames));
}

// ---------- contacts ----------

export async function findContact(email) {
  const q = new URLSearchParams({ email, status: "all", include: "taggings,list_memberships" });
  const data = await cc("GET", `/contacts?${q}`);
  return (data?.contacts || [])[0] || null;
}

export async function createContact({ email, firstName, lastName }) {
  // permission_to_send "implicit": an existing paying relationship, not a fresh opt-in.
  // We deliberately avoid /contacts/sign_up_form, which marks contacts as explicit
  // opt-ins and can re-subscribe people who had unsubscribed.
  return cc("POST", "/contacts", {
    email_address: { address: email, permission_to_send: "implicit" },
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    create_source: "Account",
  });
}

export const addTags = (contactId, tagIds) =>
  tagIds.length &&
  cc("POST", "/activities/contacts_taggings_add", { source: { contact_ids: [contactId] }, tag_ids: tagIds });

export const removeTags = (contactId, tagIds) =>
  tagIds.length &&
  cc("POST", "/activities/contacts_taggings_remove", { source: { contact_ids: [contactId] }, tag_ids: tagIds });

export const addToList = (contactId, listId) =>
  cc("POST", "/activities/add_list_memberships", { source: { contact_ids: [contactId] }, list_ids: [listId] });

export const removeFromList = (contactId, listId) =>
  cc("POST", "/activities/remove_list_memberships", { source: { contact_ids: [contactId] }, list_ids: [listId] });
