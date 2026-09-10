# Gate 14D — Read-only auth forensics for the 20:10:30.568Z canary

All items below come from read-only reads. No edit, commit, deploy, invocation, budget change or write SQL occurred.

## 1. The denial log line

Function `market-valuation-write` logs for that request:

```
2026-09-10T20:10:31.497Z  Boot   booted (time: 40ms)
2026-09-10T20:10:31.512Z  error  writer_auth_denied INVALID_API_KEY
```

`INVALID_API_KEY` is the verifier's error CODE only; the writer logs `error.code` and never `error.toJSON()`, so no header, token or detail text was emitted. The 401 body `{"error":"authentication required"}` is `DENY_UNAUTHENTICATED`, produced by `denyForVerifierStatus` for any verifier status below 500.

Material consequence: the request reached and executed function code. Authentication failed inside the function, not at the gateway.

## 2. Gateway `verify_jwt`

- `supabase/config.toml` contains 8 `[functions.*]` blocks (`record-engagement`, `vehicle-lookup`, `autofilm-feed`, `public-document-asset` false; `oem-brochure`, `oem-owners-manual`, `packet-backfill`, `oem-document-store` true). There is **no** `[functions.market-valuation-write]` block, so the repository asserts nothing.
- The deployed gateway flag itself: **UNAVAILABLE** — no read-only platform tool exposes per-function `verify_jwt` state, and no gateway edge-log row for this request is present in `function_edge_logs` (only the 20:10:03/20:05:04 cron rows appear in that window).
- What is provable instead: the function booted and ran its own auth, so whatever the effective gateway value is, it did **not** reject this request. The 401 is entirely the function's own decision.

## 3. Which auth mode was attempted, and why it refused

`authenticateCaller` calls:

```
createSupabaseContext(credentialCarrier(req), {
  auth: ["secret:*", "user"],
  env: { secretKeys: SECRET_KEYS, jwks: JWKS },
})
```

- `credentialCarrier` copied the presented `apikey` header into the verification request unchanged (the canary sent `apikey` and no `Authorization`, so no bearer mirroring applied).
- Mode order is `secret:*` first, then `user`. The returned code `INVALID_API_KEY` is the `secret` mode classification: the presented opaque key did not match any entry in the constructed key set. `user` mode produces JWT-class codes, not `INVALID_API_KEY`, so the chain terminated in `secret`.
- Status mapped below 500, so the outcome was 401 `authentication required` rather than 500 `authentication misconfigured` — meaning the key set was **non-empty** (at least `service_role` was populated); the presented credential simply was not a member of it.

Two candidate causes, neither yet confirmed: (a) the value the sandbox holds is not the value the runtime holds, or (b) `@supabase/server`'s `secret:*` mode only accepts modern opaque `sb_secret_*` keys and structurally refuses a legacy JWT-shaped service-role key. Item 4 is the discriminator.

## 4. Sandbox key vs Edge runtime key

**UNAVAILABLE.** Reading the Edge Function runtime's `SUPABASE_SERVICE_ROLE_KEY` — even to hash it — requires code running inside that runtime, which means creating or invoking a function. Both are forbidden here and neither was done. No equality or SHA-256 comparison was computed, and no value or partial value was read or printed. The sandbox-side name is present (length recorded previously, value never printed).

## 5. `SUPABASE_SECRET_KEYS` / `SUPABASE_SECRET_KEY`

Project-configured Edge Function secret names (values never displayed), 13 total:

`AUTOCURB_API_BASE`, `AUTOCURB_API_TOKEN`, `AUTOFILM_FEED_SECRET`, `AUTOLABELS_LOOKUP_SECRET`, `CRON_SHARED_SECRET`, `ENRICH_SWEEP_HOUR_UTC`, `FIRECRAWL_API_KEY`, `FIRECRAWL_API_KEY_1`, `GOOGLE_SEARCH_CONSOLE_API_KEY`, `LOVABLE_API_KEY`, `MARKETCHECK_API_KEY_1`, `MARKETCHECK_CRON_SECRET`, `OPENAI_API_KEY`.

- `SUPABASE_SECRET_KEYS` configured: **false**
- `SUPABASE_SECRET_KEY` configured: **false**

So `buildSecretKeySet` could only have produced the single `service_role` entry from the platform-injected variable. Whether that platform-injected variable is present in the runtime is **UNAVAILABLE** by the same limit as item 4 — but the 401 (not 500) implies the set was not empty.

## 6. Deployed source and containment state

- Writer bytes: `sha256 355ed5c7d0b17125265ec9e9a54b045cb25c990d80aa6a620c761f30fa807403`, identical at `ca7cb02b` and at current HEAD `1269c342` (that commit adds a test file only). The 20:04:56Z deploy was made from `ca7cb02b` with that exact hash. Platform deployment metadata naming the commit is **UNAVAILABLE**; byte identity is the evidence.
- `market_provider_budgets`: exactly 1 row — tenant `3f0f97f5-4151-4e32-88ef-e2d6fc5a3142`, provider `marketcheck`, `enabled = false`, monthly `0.07`, per-call `0.0700`, `updated_at 2026-09-10 20:10:35.412883+00`.
- `provider_request_reservations` = 0, `vehicle_market_valuations` = 0, `vehicle_market_comparables` = 0, `market_value_model_metrics` = 0, `audit_log` = 11741 (unchanged from baseline).

## Proposed next step (no work performed yet)

The only remaining unknown is item 4/5's runtime side, and it cannot be closed without executing something inside the Edge runtime. Options, in ascending intrusiveness:

1. **Static resolution first, no execution.** Read `@supabase/server@1.6.0`'s `classify-credentials` / `verify-auth` modules from the already-downloaded esm.sh sources and determine whether `secret:*` accepts a legacy JWT-shaped key at all. If it does not, the cause is proven without touching the runtime and the fix is a code change to the writer's trusted-secret handling.
2. **Only if step 1 is inconclusive:** a one-request, no-cost, no-provider probe of an existing service-role-authenticated function to compare acceptance behaviour — requires explicit authorization.
3. Configuring `SUPABASE_SECRET_KEYS` with a modern `sb_secret_*` key — requires the owner to mint and paste it, and is a secret change, out of scope here.

Recommend step 1. It is read-only, costs nothing, and either names the cause or rules it out.
