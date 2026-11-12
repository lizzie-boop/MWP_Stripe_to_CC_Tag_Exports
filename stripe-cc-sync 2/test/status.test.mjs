import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus } from "../lib/status.mjs";

test("healthy subscriber is active", () => {
  assert.equal(deriveStatus([{ status: "active" }]), "active");
  assert.equal(deriveStatus([{ status: "trialing" }]), "active");
});

test("failed renewal is payment_failed", () => {
  assert.equal(deriveStatus([{ status: "past_due" }]), "payment_failed");
  assert.equal(deriveStatus([{ status: "unpaid" }]), "payment_failed");
  assert.equal(deriveStatus([{ status: "paused" }]), "payment_failed");
});

test("cancel at period end (either Stripe field) is cancel_scheduled", () => {
  assert.equal(deriveStatus([{ status: "active", cancel_at_period_end: true }]), "cancel_scheduled");
  assert.equal(deriveStatus([{ status: "active", cancel_at: 1767225600 }]), "cancel_scheduled");
});

test("fully canceled is canceled", () => {
  assert.equal(deriveStatus([{ status: "canceled" }]), "canceled");
});

test("resubscribed after canceling is active again", () => {
  assert.equal(deriveStatus([{ status: "canceled" }, { status: "active" }]), "active");
});

test("one sub canceled while another is live does not count as canceled", () => {
  assert.equal(deriveStatus([{ status: "canceled" }, { status: "active", cancel_at_period_end: true }]), "cancel_scheduled");
});

test("never-paid signups are left alone", () => {
  assert.equal(deriveStatus([]), null);
  assert.equal(deriveStatus([{ status: "incomplete" }]), null);
  assert.equal(deriveStatus([{ status: "incomplete_expired" }]), null);
});
