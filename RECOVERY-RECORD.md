# Gate 14G.5 — Safe Recovery Record (NOT FOR MAIN)

## vehicle-enrich — constant-time, shadow-disabled safe recovery release

base_commit          7a8b2278  (content identical to HEAD 84e336d4 for this file)
base_entrypoint_sha  e9174a27742287455565ad3a8db3a94dce37d5ef1bd2a6e17d0e7fbc50e3c377
patch                vehicle-enrich-recovery.patch
patch_sha256         e3e1dcf3d99a0345564761af9f211569b08392b5d834a2848c400a57342c3e12
patch_bytes          6707
changed              1 file, +12 / -93
result_entrypoint    2116d9364381d03880fc017799f8b869547aec61ab6ac1d06b7e6e7d89e0a0ea
result_tree_sha256   0307a35faeca224b8bc7aea052baca446ddd1c59009cb6aeb21a7307368510ca
closure              5 files (4 shared deps)
verify_jwt           no per-function block -> platform default (config.toml 0c408ad354ca4a8d, unchanged)

### Reconstruction
git worktree add --detach <DIR> 7a8b2278
cd <DIR> && git apply <PATH>/vehicle-enrich-recovery.patch

### Verification
sha256sum supabase/functions/vehicle-enrich/index.ts
# expect 2116d9364381d03880fc017799f8b869547aec61ab6ac1d06b7e6e7d89e0a0ea
deno check --node-modules-dir=none --import-map=<MAP> supabase/functions/vehicle-enrich/index.ts
bunx vitest run   # expect only the shadow-activation contradictions to fail

### Property proven
No code path from vehicle-enrich to market-valuation-write. shadowPipeline is not
imported or linked. constantTimeEquals retained for BOTH service-key and cron-secret.
Certification resolver, single-writer boundary and ordinary enrichment unchanged.

## Other approved recovery artifacts (unchanged)
market-valuation-write  946abeaf  entry 4237d03377cd743e...fde4403  tree e44914f528b02367...aaa3e73a
public-listing-view     c7d6a30a  entry 9fd8853467ddc75a...8fe2c71  tree 94ba9b96221e02d5...d4588504
frontend forward patch  frontend-recovery.patch  sha 8696ca5b77fdb4eb...6ceda37f
                        3 files, +148/-2
                        - src/lib/market/publicClaim.ts            (suppressionEnabled: false)
                        - supabase/.../factorySticker/.../publicClaim.ts  (edge mirror, keeps sync invariant)
                        - src/lib/market/recoveryMode.test.ts      (13 tests, all pass under the patch)

## WITHDRAWN — no longer approved
vehicle-enrich @ c7d6a30a  entry c81bc312...5b83b99d  tree 289fcea4...beb4e463
Reason: variable-time secret comparison; reintroduces a corrected defect.
