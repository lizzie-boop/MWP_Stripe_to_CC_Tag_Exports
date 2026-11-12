import { test } from "node:test";
import assert from "node:assert/strict";
import { isRelevant, customerIdOf } from "../lib/events.mjs";

const ev = (type, previous_attributes, customer = "cus_1") => ({ type, data: { object: { customer }, previous_attributes } });

test("routine renewal update is ignored", () => {
  assert.equal(isRelevant(ev("customer.subscription.updated", { current_period_end: 1, latest_invoice: "in_1" })), false);
});

test("status-changing updates are processed", () => {
  assert.ok(isRelevant(ev("customer.subscription.updated", { status: "active" })));
  assert.ok(isRelevant(ev("customer.subscription.updated", { cancel_at_period_end: false })));
  assert.ok(isRelevant(ev("customer.subscription.updated", { cancel_at: null })));
});

test("lifecycle events and failed payments are processed; invoice.paid is not", () => {
  for (const t of ["customer.subscription.created", "customer.subscription.deleted", "invoice.payment_failed"]) {
    assert.ok(isRelevant(ev(t)), t);
  }
  assert.equal(isRelevant(ev("invoice.paid")), false);
  assert.equal(isRelevant(ev("charge.succeeded")), false);
});

test("customer id from string or expanded object", () => {
  assert.equal(customerIdOf(ev("x", {}, "cus_9")), "cus_9");
  assert.equal(customerIdOf(ev("x", {}, { id: "cus_8" })), "cus_8");
  assert.equal(customerIdOf(ev("x", {}, null)), null);
});
