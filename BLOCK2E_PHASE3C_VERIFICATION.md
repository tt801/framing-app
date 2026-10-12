# Block 2E Phase 3C — Sandbox verification checkpoint

**Result: PASS.** The Block 2E persistence foundation cleared its final hosted genuine-concurrency gate in FramersApp Sandbox (`zminmylvmtyglkujxxyk`). This checkpoint does not authorize a Production installation or deployment.

## Installation and earlier hosted gates

- Phase 3B migration: `migrations/20261009_block2e_supplier_feed_framework.sql`; SHA256 `817c1b7ff50982d03482b8b19e744ace659918cdda844e92c263378753d5974a`. Installed in Sandbox only; Production was not modified.
- Hosted read-only inspection passed for schema, indexes, FKs, checks, triggers, RPCs and helpers; private-table/RLS protections; privileged RPC `SECURITY DEFINER` and `search_path` posture; helper/guard execution posture; Block 2D cost-trigger/RPC integration; and the intact historical synthetic fixture.
- The hosted behavioural harness passed all fail-closed assertions in one rollback-only transaction: no executable `COMMIT`, final `ROLLBACK`.

## Genuine two-session concurrency evidence

Two persistent independent PostgreSQL sessions used the Supabase Session Pooler. Session A PID **660272** and Session B PID **660279** were repeatedly checked and remained stable. Test tag: `BLOCK2E-PHASE3C-CONC-670b9a6e6be6`.

1. A1 committed a disposable supplier, feed source and feed-owned product at `product_revision=1`, with zero initial cost events.
2. A2 committed a frozen, approved candidate update plan with `expected_product_revision=1`.
3. B1 used the approved Block 2D path to update that same canonical product from revision **1 → 2**, set the description ending **`B COMMITTED`** and wholesale cost to **11 GBP/each**, and create exactly one manual Block 2D cost event. B's transaction remained open.
4. A3 attempted to apply the stale revision-1 plan while B held the product lock. Direct `pg_stat_activity` evidence showed A PID 660272, application name `BLOCK2E-PHASE3C-CONC-A-670b9a6e6be6`, `state=active`, `wait_event_type=Lock`, and `pg_blocking_pids(660272)={660279}`.
5. B committed. A resumed and returned `{"state":"conflict","reason":"replan_required"}`. A's fail-closed assertions passed, then A committed the durable conflict checkpoint.

Final read-only verification **passed**: “B revision 2 retained; A conflict/replan_required durable; exactly one B cost event; historical fixture unchanged.” The disposable canonical product retained B's description, revision 2 and 11 GBP/each; stale A made no canonical overwrite and created **zero** stale-feed cost events. The feed row records `conflict` / `stale_product_revision`; the run records `partially_applied` / `replan_required`. Ownership, source and scope provenance remained correct. The pre-existing Block 2D synthetic fixture remained unchanged. Final verification artifact: `/opt/data/cache/scratch/block2e_phase3c_concurrency_VERIFY.sql` (outside this repository), SHA256 `2fde3ea3f924e5d74413104299cae7441a0431ca96d80a4e1dbfa47fa23a3f43`.

## Boundaries and retained evidence

No Production installation occurred. Feed application has no Admin UI/transport yet; an eventual service-role caller must enforce Platform Admin authorization. Retention scheduling remains future work. The successful concurrency test intentionally leaves its disposable supplier, source, product, two runs, two rows and one append-only manual cost event in Sandbox as evidence; do not weaken ownership/audit protections to remove them.
