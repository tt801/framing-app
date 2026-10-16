# Bounded Larson-Juhl catalogue fixture

`catalogue.html` contains six original primary product tiles extracted from official public UK catalogue HTML retained during discovery. Surrounding navigation, scripts, forms outside the tiles and unrelated products are omitted. The wrapper total is deliberately changed to **6**, and the tiles are combined in fixture order. This is not a complete live catalogue or a newly fetched release. No image binaries or authenticated material are included. Supplier image/content rights are not granted by fixture inclusion.

Original first-party source: https://larsonjuhl.co.uk/mouldings/

Selected tiles:

- `0475WG`, `0701AW`, `185127000E`, `20380`: original `uk-full.body`, requested with `?sort=Id&count=2326`, retrieved 2026-10-16 06:49:46 UTC. Original full response SHA-256: `287cb44e0d5b77a7d5625cb73a075d5e721cd9415f693d953effde48e3b713b3`.
- `991247116`, `999002196`: original `uk-bulk-page5.body`, requested with `?sort=Id&count=500&page=5`, retrieved 2026-10-16 06:56:01 UTC. Original full response SHA-256: `bc9d7514e60ce726002b40749504f183f22aa95c26fc4fc95ba48b7e8c15bb38`.

The extraction preserves original tile structure and values, including lazy image references, item IDs, product names, return-query URLs and variable-length **unlabeled** attribute spans. Trailing whitespace on blank lines is removed for repository diff checks. Tests must not infer field names from span position, product type from a numeric code, dimensions from `23X14`, or image rights from a URL.

`tests/helpers/larsonFixture.ts` additionally generates small synthetic HTML windows to test 500-entry pagination boundaries. Generated products are test-only, not supplier evidence. No test requires live network or hosted Supabase access.
