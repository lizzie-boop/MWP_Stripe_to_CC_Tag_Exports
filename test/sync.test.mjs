// End-to-end test of syncCustomer with Stripe, Netlify Blobs and Constant Contact faked.
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- fake Netlify Blobs ----
const blobs = new Map();
mock.module("@netlify/blobs", {
  namedExports: {
    getStore: () => ({
      get: async (k, o) => (blobs.has(k) ? (o?.type === "json" ? JSON.parse(blobs.get(k)) : blobs.get(k)) : null),
      set: async (k, v) => blobs.set(k, v),
      setJSON: async (k, v) => blobs.set(k, JSON.stringify(v)),
      delete: async (k) => blobs.delete(k),
    }),
  },
});

// ---- fake Stripe ----
let fakeCustomer, fakeSubs, lastListParams;
mock.module("stripe", {
  defaultExport: class {
    subscriptions = {
      list: (params) => {
        lastListParams = params;
        return { async *[Symbol.asyncIterator]() { yield* fakeSubs.map((s) => ({ ...s, customer: fakeCustomer })); } };
      },
    };
  },
});

// ---- fake Constant Contact (global fetch) ----
let ccContact, calls;
const TAGS = [
  { name: "Stripe: Active", tag_id: "t-active" },
  { name: "Stripe: Payment Failed", tag_id: "t-failed" },
  { name: "Stripe: Canceled", tag_id: "t-canceled" },
  // "Stripe: Cancel Scheduled" deliberately missing -> should be created
];
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const body = opts.body && typeof opts.body === "string" ? JSON.parse(opts.body) : null;
  calls.push({ method: opts.method, path: u.pathname, body });
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status });

  if (u.pathname.endsWith("/token")) return json({ access_token: "at", refresh_token: "rt2" });
  if (u.pathname === "/v3/contact_tags" && opts.method === "GET") return json({ tags: TAGS });
  if (u.pathname === "/v3/contact_tags" && opts.method === "POST") return json({ tag_id: "t-sched", name: body.name }, 201);
  if (u.pathname === "/v3/contacts" && opts.method === "GET") return json({ contacts: ccContact ? [ccContact] : [] });
  if (u.pathname === "/v3/contacts" && opts.method === "POST") return json({ contact_id: "c-new" }, 201);
  if (u.pathname.startsWith("/v3/activities/")) return json({ activity_id: "a1" }, 201);
  return json({ error: "unexpected " + u.pathname }, 500);
};

Object.assign(process.env, {
  STRIPE_SECRET_KEY: "sk_test", CC_CLIENT_ID: "id", CC_CLIENT_SECRET: "sec",
  CC_REFRESH_TOKEN: "rt1", CC_REACTIVATION_LIST_ID: "list-react",
});

const { syncCustomer } = await import("../lib/sync.mjs");
const activity = (name) => calls.filter((c) => c.path === `/v3/activities/${name}`);

beforeEach(() => {
  calls = [];
  fakeCustomer = { id: "cus_1", email: "Reader@Example.com", name: "Pat Reader" };
});

test("payment failure: tags Payment Failed, removes Active, adds to reactivation list", async () => {
  fakeSubs = [{ status: "past_due" }];
  ccContact = { contact_id: "c1", taggings: ["t-active"], list_memberships: [] };

  const r = await syncCustomer("cus_1");
  assert.equal(r.status, "payment_failed");
  assert.equal(r.email, "reader@example.com");
  assert.deepEqual(lastListParams.expand, ["data.customer"]); // one Stripe call, customer embedded
  assert.deepEqual(activity("contacts_taggings_add")[0].body, { source: { contact_ids: ["c1"] }, tag_ids: ["t-failed"] });
  assert.deepEqual(activity("contacts_taggings_remove")[0].body.tag_ids, ["t-active"]);
  assert.deepEqual(activity("add_list_memberships")[0].body.list_ids, ["list-react"]);
  // the missing tag was created once
  assert.equal(calls.filter((c) => c.path === "/v3/contact_tags" && c.method === "POST").length, 1);
});

test("recovery: back to Active, failure tag and list removed", async () => {
  fakeSubs = [{ status: "active" }];
  ccContact = { contact_id: "c1", taggings: ["t-failed"], list_memberships: ["list-react"] };

  const r = await syncCustomer("cus_1");
  assert.equal(r.status, "active");
  assert.deepEqual(activity("contacts_taggings_add")[0].body.tag_ids, ["t-active"]);
  assert.deepEqual(activity("contacts_taggings_remove")[0].body.tag_ids, ["t-failed"]);
  assert.equal(activity("remove_list_memberships").length, 1);
  // tag IDs came from cache this time
  assert.equal(calls.filter((c) => c.path === "/v3/contact_tags").length, 0);
});

test("already correct: no write calls at all", async () => {
  fakeSubs = [{ status: "canceled" }];
  ccContact = { contact_id: "c1", taggings: ["t-canceled"], list_memberships: ["list-react"] };

  const r = await syncCustomer("cus_1");
  assert.equal(r.status, "canceled");
  assert.equal(calls.filter((c) => c.path.startsWith("/v3/activities/")).length, 0);
});

test("missing contact is created with implicit permission, not via sign_up_form", async () => {
  fakeSubs = [{ status: "canceled" }];
  ccContact = null;

  const r = await syncCustomer("cus_1");
  assert.equal(r.contactId, "c-new");
  const create = calls.find((c) => c.path === "/v3/contacts" && c.method === "POST");
  assert.equal(create.body.email_address.permission_to_send, "implicit");
  assert.equal(create.body.first_name, "Pat");
  assert.ok(!calls.some((c) => c.path.includes("sign_up_form")));
});

test("contact deleted in Constant Contact is left alone", async () => {
  fakeSubs = [{ status: "canceled" }];
  ccContact = { contact_id: "c1", deleted_at: "2026-01-01", taggings: [] };
  const r = await syncCustomer("cus_1");
  assert.match(r.skipped, /deleted/);
});

test("per-status lists: moves contact from Payment Failed list to Active list on recovery", async () => {
  process.env.CC_LIST_ACTIVE = "list-active";
  process.env.CC_LIST_PAYMENT_FAILED = "list-failed";
  process.env.CC_LIST_CANCELED = "list-canceled";
  try {
    fakeSubs = [{ status: "active" }];
    ccContact = { contact_id: "c1", taggings: ["t-failed"], list_memberships: ["list-failed", "list-react", "other-list"] };

    const r = await syncCustomer("cus_1");
    assert.deepEqual(r.lists, {
      CC_LIST_ACTIVE: "added",
      CC_LIST_PAYMENT_FAILED: "removed",
      CC_LIST_CANCELED: "unchanged",
      CC_REACTIVATION_LIST_ID: "removed",
    });
    const removed = activity("remove_list_memberships").map((c) => c.body.list_ids[0]).sort();
    assert.deepEqual(removed, ["list-failed", "list-react"]); // unrelated lists untouched
    assert.deepEqual(activity("add_list_memberships").map((c) => c.body.list_ids[0]), ["list-active"]);
  } finally {
    delete process.env.CC_LIST_ACTIVE;
    delete process.env.CC_LIST_PAYMENT_FAILED;
    delete process.env.CC_LIST_CANCELED;
  }
});

test("customer without email is skipped", async () => {
  fakeCustomer = { id: "cus_1", email: null };
  fakeSubs = [{ status: "canceled" }];
  const r = await syncCustomer("cus_1");
  assert.match(r.skipped, /no email/);
});
