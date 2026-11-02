// Static, dependency-free safety guard. Dynamic semantics are tested in the
// scratch-only supabase/tests/rooftopos_harness.sh PostgreSQL fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rollback = readFileSync(
  "supabase/proposed/20261109010000_legacy_feed_hardening.rollback.sql",
  "utf8",
);
const harness = readFileSync("supabase/tests/rooftopos_harness.sh", "utf8");
const runbook = readFileSync("docs/vehicle-history/03-runbook-and-release.md", "utf8");
const transition = readFileSync("docs/vehicle-history/04-legacy-feed-transition.md", "utf8");
const review = readFileSync("docs/vehicle-history/05-review-package.md", "utf8");

const statements = rollback
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

test("rollback never silently re-enables unsigned feed auth for any dealer", () => {
  assert.doesNotMatch(statements, /\bUPDATE\s+(?:public\.)?legacy_feed_bindings\b/i);
  assert.doesNotMatch(statements, /\bTRUNCATE\s+(?:TABLE\s+)?(?:public\.)?legacy_feed_bindings\b/i);
  assert.doesNotMatch(statements, /\bDELETE\s+FROM\s+(?:public\.)?legacy_feed_bindings\b/i);
  assert.doesNotMatch(statements, /\bDROP\s+TABLE\b/i);
});

test("rollback revokes browser SQL table and privileged RPC access", () => {
  assert.match(statements, /REVOKE\s+ALL\s+ON\s+public\.legacy_feed_bindings\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  assert.match(statements, /REVOKE\s+ALL\s+ON\s+public\.legacy_feed_receipts\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  for (const name of ["legacy_feed_claim_request", "legacy_feed_complete_request", "legacy_feed_legacy_allowed", "legacy_feed_hold_archived"]) {
    assert.ok(rollback.includes(name), name + " must be covered by RPC revoke");
  }
  assert.match(statements, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+TO\s+service_role/i);
});

test("scratch regression exercises both signed-only and legacy-allowed dealers", () => {
  assert.match(harness, /'autofilm_feed','allowed'/);
  assert.match(harness, /'autofilm_feed','rejected'/);
  assert.match(harness, /'allowed,rejected'/);
  assert.match(harness, /post_flags.*pre_flags/);
  assert.match(harness, /unsigned_rejected/);
  assert.match(harness, /unsigned_allowed/);
  assert.match(harness, /legacy_feed_legacy_allowed/);
  assert.match(harness, /fail-closed rollback preserves dealer auth flags/);
});

test("documentation does not advertise mass security downgrade as rollback", () => {
  assert.doesNotMatch(runbook, /every dealer back to legacy/i);
  assert.doesNotMatch(review, /every dealer back to legacy/i);
  assert.match(transition, /never globally switch dealers back to unsigned/i);
  assert.match(runbook, /preserves each dealer/i);
  assert.match(review, /preserves per-dealer signed-only cutovers/i);
});
