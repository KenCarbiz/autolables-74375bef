# AutoLabels staging: SQL applied 2026-11-03 to 2026-11-12, classified for production

Reconstructed from the staging run records (paths under `rooftopos/hosted/`), in the order they were applied; B2 ran on
2026-11-03 and the Card 3 shutdown on 2026-11-12, and the record of each row gives its exact time. Final staging state: `transport_enabled = false`, CHECK lock present, rtgip function digest `30dc3dd02521e28ade139dc27a7e548e`
(57 functions). No hosted database was read for this list; it comes from the records only.

Classes: PRODUCTION (carried into a packet, byte for byte unless noted), STAGING-ONLY (enrollment, keys, drills,
probes or shutdowns of the staging node; never carried), SUPERSEDED (replaced by a different production design).

| # | File (sha256 prefix) | Record | Class | Production packet / reason |
|---|---|---|---|---|
| 1 | S1 `20261030000000_rooftopos_spine.sql` (5aef1fd2) | `autolabels/b2-evidence` | PRODUCTION | 01-S1 |
| 2 | S2 `20261108000000_canonical_store_registry.sql` (7c523003) | `autolabels/b2-evidence` | STAGING-ONLY | Not a runtime dependency: nothing in R, E, AR-1, ar3 or the runtime references it. It is already on production main as an AL proposal, so it was left out of P2 |
| 3 | S3 `20261109000000_vehicle_history_foundation.sql` (e86d422b) | `autolabels/b2-evidence` | PRODUCTION | 02-S3, included whole. R reads `vehicle_instances.previous_instance_id/custody_state/listing_id`, `vehicle_custody_milestones` and `vehicle_reappearance_reviews`, and uses the `vehicle_history_record_milestone` lock. E reads `custody_state` |
| 4 | D `rtgip_v2_delivery.proposed.sql` (5bdde923) | `autolabels/b2-evidence` | PRODUCTION | 03-D |
| 5 | R `rtgip_source_readers.proposed.sql` (5d83cfd7) | `autolabels/b2-evidence` | PRODUCTION | 04-R |
| 6 | E `rtgip_labels_effects.proposed.sql` (385cba7f) | `autolabels/b2-evidence` | PRODUCTION | 05-E |
| 7 | H `H_sandbox_exec.sql` (f0132f8b), H2 `H2_sandbox_exec_sequence.sql` (d61c7858) | `autolabels/b2-evidence` | PRODUCTION | 06-H. The sandbox_exec real-role test that followed was rolled back and is not carried |
| 8 | C-S1 seed (4e6036ac / 541e9d4b) | `c-staging/cs1/CS1-CLOSURE.md` | STAGING-ONLY | staging tenant and fixture seed |
| 9 | C-S3 A3 rooftop mapping | `c-staging/cs3/CS3-CLOSURE.md` | STAGING-ONLY | staging rooftop map rows; production maps at enrollment |
| 10 | C-S4 key-import install `s1_autolabels_1_install` (3f110a16), import `_2_import` (eb2e5ac6), removal `_4_removal` (3b585062) | `c-staging/cs4s` | STAGING-ONLY | rtgip/2 HMAC key import. It left the residual `key_import_tickets_guard`, `key_import_tickets` and `key_import_install`, which production never gets |
| 11 | B4 `al-B4.sql` (5da678e7) | `c-staging/cs6/f3/work/b4/B4-RESULT.md` | PRODUCTION (part) | 07-L carries the `local_app` UPDATE (line 84). The 4 staging connection rows are STAGING-ONLY; production uses template T1 |
| 12 | AR-1 r2 `ar1-al.sql` (552fd9a4) | `c-staging/cs6/f3/work/ar1/phase1/PHASE1-RESULT.md` | PRODUCTION | 08-AR1. The apply section is verbatim; the pre and post checks use the production dark state |
| 13 | AR-1 phase 2: -2 key import, K5, P2 removal | `c-staging/cs6/f3/work/ar1/phase2/run/PHASE2-RUN-RECORD.md` | STAGING-ONLY | rtgip/2 keys |
| 14 | C3 grants `A-app-1-grants-al.r2` (2ac01bf6; wrap `grants-al.wrap.sql` 7af22afd) | `c-staging/cs6/f4/run-c2c6/C2-C6-BUNDLE.md` | SUPERSEDED | 10-EDGE. Staging gave `postgres` SET-only membership in the duty roles; production gives it to the dedicated `rtgip_edge` login instead |
| 15 | K6-al (`K6-al.filled.sql` 5dacda7d) | `c-staging/cs6/f4/run-c2c6/C2-C6-BUNDLE.md` | STAGING-ONLY | staging rtgip/2 key bindings |
| 16 | Phase D, E, F runs: F1 check-drop, F3 transport, F4 flags, F7 HD sign-in and sign-out, W0 windows, SD shutdowns, W-P1 | `c-staging/cs6/f4/`, `STAGING-RECORD.md` | STAGING-ONLY | activation drills; each ended dark |
| 17 | Card 1 `ar3-al.sql` (a26636e4, inner 7539d6e9) | `p0/ed25519/run-c1/CARD1-RECORD.md` | PRODUCTION | 09-AR3, from the same generator (`gen_ar3.py`) with production identities. It regenerates the staging file byte for byte when given the staging identities |
| 18 | P3-kat-check / P3-kat-probe from AL | `p0/ed25519/run-c1/CARD1-RECORD.md` | STAGING-ONLY | probes |
| 19 | Card 2 `K5-v3-al` filled (stg keys) | `p0/ed25519/run-c2/CARD2-RECORD.md` | PRODUCTION (template) | T2-K5-v3-al.template.sql (env prd, PENDING until the owner's key ceremony) |
| 20 | Card 3: `P3-proto-al` (dc0d8f7f), `F4-al-1-check-drop-r3` (17c405b0), `-3-flags-A` (f25daf76), `-4-transport-on` (0d28ba0b), `-7-flags-B` (c7c97e9c), P3-http-probe, `P3-ready-probe` (d4cc430e), `HD-signin-al` (8c9b0c90, twice), HD-publish, `P3-al-alac-send-v2` (e8d7e2e4), `-v3` (b8285632), `HD-signout-al` (5d7feac0), `SD-al-shutdown` (bd621260) | `p0/ed25519/run-c3/CARD3-RECORD.md` | STAGING-ONLY | activation, sends and shutdown; production stays dark |

Production expectation after step 10: the staging function set minus the staging-only `key_import_tickets_guard`, so
`rtgip_fn_digest = 0fcc549679f0ba6ad1555020dfc3adf9` over 56 functions. Adding that one entry back gives exactly the
staging `30dc3dd0`, which the local test re-derives. Component digests S1 `2e6e815d`, S3 `cc7e6e9a`, R `8a8156a7`
and E `4794f427` equal staging B2. D becomes `babcf576` after AR-1 and ar3, as on staging.
