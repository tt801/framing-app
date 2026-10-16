# LION UK product-only mouldings adapter

## Boundary

Implementation only. No supplier/source registration, live feed run, deployment,
MCP change, migration or external database mutation is part of this change.
The supplier is LION Picture Framing Supplies Ltd (https://www.lionpic.co.uk/).

The server-owned adapter reuses the existing acquisition -> normalization ->
planner -> bounded batch staging -> freeze path. It always supplies `dry_run`,
`authoritative=false`, `validationSafeForMissing=false` and
`missingInferenceEnabled=false`. There is no canonical cost capability.
The existing orchestration policy rejects cost candidates and policy escalation.
Existing immutable dry-run headers, SQL approval/application guards and Admin
control projections keep these plans non-actionable. The planning facade has no
approve/apply capabilities. There is no automatic approval/application path.
These are adapter/run guarantees, not a new source-wide database constraint
against arbitrary privileged creation of a different run.

## Acquisition and evidence

Only the official EstLite CSV is acquired:
https://cdn.lionpic.co.uk/website/media/m4vnra0t/estlite_lionmouldings.csv

One anonymous server GET; no browser, authentication, cookies, redirects or
retry. Maximum timeout 30 seconds (covers headers and body), maximum decoded
body 1 MiB, operational product count 500-10,000. A smaller structurally valid
report can be parsed offline for bounded fixtures; production acquisition still
requires the operational minimum. HTTP 200, CSV content type, response URL,
Content-Length (when it describes decoded bytes), streaming size and absence of
Content-Range are checked. Body/read failures, malformed UTF-8, controls, bad
quotes, partial records, wrong row shapes, unexpected headers/preamble,
missing/incorrect dated terminal footer, invalid calendar dates, invalid fields,
blank identifiers, duplicates and case-fold collisions fail closed. No partial
catalogue is planned after these failures; existing check-error handling records
the failure during a future authorized operation.

SHA-256 is over the original response bytes. Retrieval timestamp, byte size,
ETag and Last-Modified are retained. Report generation date/time and dated
footer are retained without inventing a timezone, publication date or price
valid-from date. Normalization reparses the checksum-bound bytes and rejects
modified rows/generation evidence.

The companion CSV, live catalogue and discontinued catalogue are NOT fetched or
unioned by this adapter:

- https://cdn.lionpic.co.uk/website/media/q5gbrtcx/lion_mouldings.csv
- https://www.lionpic.co.uk/picture-frame-moulding/
- https://www.lionpic.co.uk/discontinued-moulding/

## Normalization and review

Exact supplier codes are strings: no case conversion, zero removal, suffix
removal or chop/sample-to-length mapping. Names are retained raw in evidence
and trimmed only for the existing canonical description contract. Category
`frame` / subcategory `moulding` use existing categories, not name-derived facts.
No material, colour, finish or dimensions are inferred from names.

CSV Width has no explicitly qualified unit/zero semantics. It stays raw and
EVERY row is held in the existing review action with `lion_dimensions_review`.
Consequently the initial implementation proposes no CREATE or UPDATE actions,
including for otherwise ordinary mouldings. This is intentional: lifting that
restriction requires separate source qualification and implementation approval.

Additional review warnings retain known source-membership disagreements,
explicit discontinued-list evidence, explicit discontinued-when-out-of-stock
(phase-out) evidence, quality/suffix ambiguity and possible chop/sample/
chevron/slip/spacer/tray/component scope. Retained exact-SKU discovery alerts
are dated, bounded warnings, not exhaustive or current lifecycle authority.
No discovery-only SKU is added to the primary CSV's candidate set.
Duplicate/schema/truncation anomalies are unsafe to plan and reject the whole
acquisition instead of inventing review candidates with unreliable identities.
Existing canonical identity/ownership collisions use the generic review path.

Prices and stock (including blank, zero and negative stock) are raw audit
strings only. `candidate.cost` is absent; `cost_changes=0`. No effective price,
unit, tax basis, currency or availability is inferred. Canonical lifecycle and
availability are preserved through row policy; catalogue presence/absence do
not activate, discontinue or mark products missing. Contract-required initial
`active` / `unknown` values are non-actionable defaults on review-only rows,
not assertions about existing canonical lifecycle. Explicit discontinued,
phase-out and temporary stock status are not equated.

No images are acquired or downloaded; the CSV provides no image candidates.
Website asset rights stay unknown. Dedicated image-library promotional
permission is not generalized to website images.

## Future operational resolution

After separately authorized registration, the existing registry binds only:

- supplier name: `LION`
- supplier slug: `lion`
- source_key: `lion-uk-public-mouldings`
- scope_key: `uk-mouldings-lengths`
- allows_authoritative_snapshots: `false`

Supplier/source UUIDs must be valid and come from the matching persisted
records; there are no LION database UUID constants. The Admin read projection
and authenticated manual handler reuse this resolver. Manual Check Now still
requires the normal Platform Admin/origin/request, Sandbox environment,
source-policy, execution lease and persistence readback guards. Registry
`liveChecking=true` expresses future manual capability, not registration or
permission to execute now. Schedule is null; scheduled LION execution is
explicitly rejected before lease claim, acquisition or planning. The existing
Wessex and International policies and Larson identity binding are preserved.

## Retained verification

The committed fixture contains 11 exact discovery rows with original report
preamble/header/footer, reserialized as UTF-8 CRLF. Its provenance records
original acquisition and fixture hashes. Synthetic size-boundary rows are
clearly test-only; the full live catalogue is not committed.

An offline check against retained discovery bytes verified 71,834 bytes,
SHA-256 `dbd60f693d3264d3b21931c00ff9a168dd29484320aaaf03f18a25210dfe09d5`,
1,268 rows / distinct exact codes, exact candidate identity parity, fixture
subset equality and membership-warning parity. Planner output: 1,268 review,
zero create/update/cost_changes/potential_missing. No network or database was
used in that proof.

Tests cover parser/acquisition bounds and failures, exact identities,
normalization, lifecycle/cost/missing protections, policy-injection rejection,
real in-memory orchestration/batching, Admin capability projection, persisted
identity resolution, scheduling rejection, authentication and dry-run controls.
Existing supplier regression suites additionally exercise generic immutable
run/SQL approval/application guards in disposable local databases only.

Commands:

- `npm --prefix admin run test -- tests/lion-catalogue.test.ts tests/lion-fetch-check.test.ts tests/lion-normalization.test.ts tests/lion-registry.test.ts tests/lion-operational-check.test.ts tests/lion-planning-policy.test.ts`
- `npm --prefix admin run test -- --testTimeout=20000`
- `npm --prefix admin run typecheck`
- `npm --prefix admin run build`
- Changed-file ESLint, diff whitespace and secret-pattern checks.

Existing `supplier-feed-checks.ts` has nine pre-existing explicit-any lint
findings, verified identical against HEAD; no unrelated cleanup is included.
The optional real-PostgreSQL integration suite is skipped unless explicitly
configured. No external PostgreSQL configuration is required for this phase.
