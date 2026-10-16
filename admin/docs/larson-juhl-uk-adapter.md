# Larson-Juhl UK public catalogue adapter

## Scope and policy

- Supplier: Larson-Juhl UK.
- Official source: https://larsonjuhl.co.uk/mouldings/
- Source classification: **C** — useful public catalogue, not qualified for lifecycle/missing inference.
- Adapter ID and release namespace: `larson-juhl-uk-public-catalogue`, version `1`.
- Scope: `uk-public-mouldings-category`.
- Mode: **dry_run only**; authoritative snapshots, missing inference and canonical cost are disabled.
- Internal adapter factory: `createLarsonJuhlAdapter()` in `feedAdapters.ts`.
- The operational registry binds Larson UUIDs from exact persisted supplier name/slug, source key and scope, with false source authority. Manual Check Now is available only after matching database registration and the existing Sandbox/environment guards. No source UUIDs are invented or hardcoded; scheduling remains disabled.

This implementation is not permission to register, execute, approve/apply or deploy. No migration is required. Existing Wessex and International factories, operational identities, acquisition rules and release namespaces are unchanged.

## Acquisition and completeness

`larsonJuhlFetchCheck.ts` requests anonymous first-party HTML using explicit `sort=Id&count=500&page=N` windows, not the site's misleading default-size lazy-loader arithmetic. It derives page count from the advertised category total. It never fetches images, authenticated prices or detail pages.

Bounds: 500 entries/window, 20 windows, 10,000 entries, 3 MB/window, 32 MB total responses, 30-second maximum per-request/body-read timeout and 240-second overall acquisition budget. Requests are serial with at least 10 seconds between completed requests, following the retained robots evidence. Redirects are not followed; credentials are omitted. Unexpected HTTP status, content type, destination, invalid UTF-8, malformed evidence or missing primary markup fails closed. Response streams are byte-bounded and cancelled on failure/timeout.

`larsonJuhlCatalogue.ts` uses the runtime dependency `parse5` (pinned to the already-used 7.3.0) to parse primary listing tiles, excluding navigation/related products. It checks:

- exactly one advertised nonzero bounded total and one explicitly closed primary listing;
- explicitly closed product tiles, matching nonempty string SKU/data-id, product title and approved first-party product URL;
- complete expected window lengths, ordered page URLs/numbers and stable advertised totals;
- exact unique IDs and no case-fold collisions across windows;
- final measured coverage equal to the advertised total.

The retained first window was requested with `count=2326` and capped at 500. The parser accepts that bounded first-window provenance without rewriting its original URL; live acquisition always requests 500.

Every page retains original request URL, retrieval time, raw-byte size/hash and available ETag/Last-Modified. Product references remove only presentation return queries. The derived artifact is a UTF-8 JSON manifest `{version:1, rows:[...]}`, sorted by exact SKU, with the parser's fixed row field order. Its hash and byte size refer to those actual manifest bytes, not to the raw HTML. Raw response sizes/hashes remain separately recorded per page. The manifest hash is release identity; presentation/session changes do not produce false releases. It intentionally has a different serialization/hash from the discovery script's alphabetically keyed manifest.

No supplier publication date is invented from acquisition time, HTTP headers or copyright years. Only `CheckedFeedRelease`'s date fields accept null; Wessex's original `PublicationEvidence` contract remains strict.

Complete observed enumeration is not an atomic authoritative supplier lifecycle release. Count/identity checks cannot establish disappearance semantics.

## Exact normalization and review behavior

`larsonJuhlNormalization.ts` rechecks catalogue coverage and its semantic manifest before asserting completeness, binds candidates to the real run through `normalizeForRun`, and uses the existing strict validator.

Normalized fields:

- `sourceProductKey` and `fields.supplierSku`: exact supplier string, with origin `supplier_provided`; no numeric coercion/case/zero normalization.
- `fields.supplierDescription`: observed product title.
- `fields.catalogScope`: `uk-public-mouldings-category`.
- `item.path`: first-party product URL; original data-id and complete raw product row remain private source evidence.
- category/subcategory: rules below, with review for ambiguity.
- initial lifecycle `active` and availability `unknown`: a required new-record convention, not supplier stock/lifecycle evidence. Existing differences cannot become updates.
- `asset.sourceUrl`, attribution `Larson-Juhl UK`, rights `unknown`, when there is an actual product image reference.

All variable-length unlabeled catalogue attributes remain raw evidence; there is no positional colour/finish/profile/certification parsing. The initial adapter deliberately does not acquire or parse details: colour, finish, material, collection, profile, certification, dimensions, pack quantities and base-UOM mapping are not asserted from catalogue prose. Any future optional enrichment must bind explicitly labelled detail evidence to the exact SKU, preserve units and obtain its own tests/authorization. The current tests prove dimensions remain absent even for numeric names/attributes or unbound labelled specifications elsewhere on a page.

Product type rules:

1. Names with the whole word `sample` or `chevron` use existing category `other`, subcategory `sample`; they are never ordinary frame stock or priced lengths.
2. Other names with the whole word `moulding` use category `frame`, subcategory `moulding`, based on supplier title plus category membership.
3. Remaining entries use existing fallback category `other` **only in a mandatory review row**, without an invented stock subtype. They carry `larson_category_review` and retain all source evidence. They are not automatically ingested.

The generic planner gains optional adapter-supplied row policy that can only restrict actions: a review reason forces the existing `review` action; `preserveLifecycle` converts any existing lifecycle/availability disagreement into review and discards mutation diffs. These options are absent for Wessex/International, leaving their behavior unchanged. Rejections/provenance errors are not converted into valid candidates.

Known retained discontinued evidence (`https://larsonjuhl.co.uk/discontinued/`, captured 2026-10-16 06:49:05 UTC) lists `991247116` and `945008001`. Exact matching items always receive `larson_lifecycle_review`, regardless of public catalogue presence. This is a conservative review hold, not an exhaustive/current discontinuation feed or a canonical discontinued assertion. Existing discontinued/superseded/unavailable products are never automatically reactivated by listing presence.

`sourceEvidenceByRow` retains raw product data, classification/lifecycle/cost qualification flags, page provenance, manifest hash and relevant discontinued evidence through the existing fingerprinted staged JSON path. Candidate fields do not gain unsupported canonical columns.

## Costs and images

The authenticated UK price list is unqualified. No amount, currency, denominator, VAT basis, tier or effective date is inferred. `Candidate.cost` is absent; existing independently sourced costs are not cleared, and plans have zero cost changes. No public price field is promoted even if presentation later changes; a cost-policy change requires separate qualification.

Image URLs are private references only. No image binary is fetched, copied or redistributed, and no usage/redistribution rights are claimed. The two observed `/content/files/icons/no-image-medium.png` references are retained as raw evidence but omitted from candidate assets. A source reference does not establish that image bytes remain accessible or licensed.

## Proof and fixtures

The committed fixture is six selected original primary tiles with a clearly adjusted total, not the complete 2,326-entry catalogue. Generated pagination fixtures are explicitly test data; all tests use mocked transport and no live supplier network.

An additional offline run against all five retained original response bodies exercised the implemented TypeScript parser, normalizer and existing planner, comparing every SKU/data-id/name/product URL/image/attribute array against all 2,326 discovery rows:

- page sizes: 500, 500, 500, 500, 326;
- 2,326 exact distinct string SKUs/data IDs, no missing/duplicate/mismatched IDs;
- 106 explicit sample candidates represented as other/sample;
- 106 mandatory category-review rows plus one known lifecycle-conflict row;
- prospective empty-canonical-state plan: 2,219 creates, 107 reviews, zero updates/rejects/missing/cost changes;
- every row retains source evidence; two no-image placeholders are not candidate image assets.

These are **offline prospective counts**, not persisted Sandbox products or runs. Actual registration/planning must freshly read canonical/alias state and may yield different reconciliation actions.

Focused tests cover parser/identity/completeness, transport timeouts/pacing, semantic replay, normalization, review restrictions, lifecycle/missing/cost policy and the registry. Disposable PGlite integration uses existing orchestration, batched staging, freeze, source checks and Admin/control projections, proving dry-run denial of approval/application and zero local canonical/cost events. Existing Admin regressions cover Wessex and International. No hosted database execution is part of these tests.

## Eventual Sandbox registration — proposal only

Target: `zminmylvmtyglkujxxyk`, after separate explicit authorization and fresh live-schema/collision checks.

Supplier values:

- `name`: `Larson-Juhl UK`
- `slug`: `larson-juhl-uk`
- `status`: `draft`
- `asset_rights_status`: `unknown`
- No adapter-specific `source_metadata` is required; leave the schema default `{}` when registering.

The adapter requires no metadata JSON to grant capability or policy. Its enforced binding is supplier name `Larson-Juhl UK`, slug `larson-juhl-uk`, the source key/scope below, matching supplier UUIDs and persisted false authority, plus the existing exact Sandbox/environment guards. The operational service resolves identity before claiming an execution attempt; mismatches cannot write or acquire. Server-owned dry-run/no-cost/no-missing policies remain unchanged. Metadata is not security enforcement.

Source values:

- supplier ID: database-generated from the approved new supplier;
- `source_key`: `larson-juhl-uk-public-mouldings`;
- `scope_key`: `uk-public-mouldings-category`;
- `allows_authoritative_snapshots`: `false`.

Logical name: Larson-Juhl UK public mouldings catalogue. Logical URL: https://larsonjuhl.co.uk/mouldings/. The source table has no name/URL/metadata columns; do not invent INSERT columns or a migration. The URL remains server-owned adapter configuration.

No database records were created by this repository implementation. Registration does not authorize acquisition, check persistence, attempts, plans or canonical mutation. A later approved planning proof must enumerate the selected orchestration entry point's write set, including mandatory source checks; manual operational execution additionally creates execution attempts. The service verifies a dry-run `planned` status, false authoritative/validation-safe-for-missing/missing flags and zero cost changes before reporting success. Its existing RPC facade cannot approve or apply. Scheduled Larson execution is explicitly rejected before any claim or acquisition.

## Limitations

- Not an atomic lifecycle snapshot; no missing inference, automatic retirement or reactivation.
- Category classification remains conservative and review-gated; lifecycle evidence is a retained hold, not a live exhaustive status feed.
- Catalogue-only: explicitly labelled optional detail enrichment is deferred rather than guessed.
- No qualified cost source or image rights.
- No live acquisition benchmark, Sandbox registration/execution or hosted application UAT has been performed. The pacing/deadline may fail closed on a slow/large source.
- Manual Check Now capability is implemented and deterministically tested, but matching Sandbox database registration, deployment/runtime readiness and separately authorized live proof are still required. No environment or deployment configuration is changed by this registry fix.
