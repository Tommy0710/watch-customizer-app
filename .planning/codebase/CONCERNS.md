# Codebase Concerns

**Analysis Date:** 2026-08-04

## Tech Debt

**Prompt-engineering fragility in the image-generation pipeline:**
- Issue: The entire visual quality of the AI-generated watch depends on a handful of magic constants tuned "by eye" against a small number of real test generations, not derived from any measurable model. Current values in `src/app/api/generate/route.ts`: `STRAP_MAX_DIMENSION = 1600`, `FACE_TO_STRAP_WIDTH_RATIO = 0.16`, `SHORT_END_TOP_RATIO = 0.28`, `FACE_DETAIL_WIDTH_RATIO = 0.40`. The inline comments document a history of regressions while tuning these (e.g. `FACE_TO_STRAP_WIDTH_RATIO` was walked `0.23 → 0.20 → 0.10 → 0.07`, with `0.07` causing the model to render the strap as two disconnected bands, before settling back at `0.16`; `SHORT_END_TOP_RATIO` went `0.42 → 0.33 → 0.28` because the model kept ignoring the intended ~41% split, one real run coming back at ~75% instead).
- Files: `src/app/api/generate/route.ts:70-162`, `src/lib/strapProfile.ts` (prompt-clause construction, `buildStrapProfileClause`)
- Impact: Any future adjustment to these ratios (or to the ~750-word inline prompt string at `src/app/api/generate/route.ts:173`) requires manual visual re-testing across a range of strap/face pairs — there's no automated regression check, so a "fix" for one strap style can silently break proportions on another. The comments themselves record at least 3 past regressions that shipped before being caught by a human.
- Fix approach: Build a small fixed set of reference strap+face pairs and manually re-generate + eyeball them before merging any change to these constants or the prompt text; consider capturing "known good" output URLs/hashes for quick before/after comparison. No automated way to verify this exists today.

**FLUX-2-PRO output is inherently stochastic:**
- Issue: `replicate.run("black-forest-labs/flux-2-pro", ...)` is called with a fixed `seed: 19826` (`src/app/api/generate/route.ts:172`), but a fixed seed does not guarantee deterministic output for every prompt/image combination on this model — different strap/face inputs with the same seed can still produce structurally broken results (forked straps, misplaced case, wrong color), as documented in the tuning comments.
- Files: `src/app/api/generate/route.ts:170-194`
- Impact: Customers can get a broken/unusable generated image with no automatic quality check or retry-on-bad-output — the only retry path is for a specific Replicate safety-filter error (`E005`/"flagged as sensitive", lines 183-194), not for generally malformed output.
- Fix approach: No output validation exists (e.g. no check that the returned image has a watch-like structure). Consider a "regenerate" affordance in the UI so the customer can manually retry a bad result, since the app cannot detect bad output server-side.

**Unused module: `src/lib/strapGeometry.ts` (395 lines, never imported):**
- Issue: This file implements full connected-component analysis (flood fill, image moments, erosion) to detect and re-stack two-piece strap photos into a single synthetic strap, with its own exported entry point `normalizeStrapLayout`. `grep` across `src/` confirms no other file imports `strapGeometry` — it is not wired into `/api/generate` or anywhere else in the request pipeline.
- Files: `src/lib/strapGeometry.ts` (see especially the module doc comment at lines 1-10 and the exported `normalizeStrapLayout` at line 325)
- Impact: 395 lines of non-trivial, untested geometry code that appears to solve a real problem (two-piece strap photos breaking the face-placement assumption in `/api/generate`) but is currently dead — the problem it was built for is not actually being handled in production today unless something else silently began covering for it.
- Fix approach: Either wire `normalizeStrapLayout` into `/api/generate`'s strap-processing step (before the resize/composite steps) if two-piece strap photos are still a real occurrence in the catalog, or delete the file if the underlying photo layout issue no longer exists.

**Dead code: unused canvas-merge helper in `CombineSection.tsx`:**
- Issue: `mergeImagesWithCanvas` (`src/components/CombineSection.tsx:16-61`) is fully implemented but its only call site is commented out at line 95 (`//const compositeBase64 = await mergeImagesWithCanvas(...)`). The actual `/api/generate` call sends `selectedStrap.image` and `uploadedFace` directly instead.
- Files: `src/components/CombineSection.tsx:16-61, 95`
- Impact: Low — dead code adds confusion for anyone reading this file trying to understand the real data flow into `/api/generate`.
- Fix approach: Delete `mergeImagesWithCanvas` and the commented-out call.

**Unused dependency: `@supabase/supabase-js`:**
- Issue: Listed in `package.json` (`"@supabase/supabase-js": "^2.103.0"`) but nothing in `src/` imports it (confirmed via `grep -rl supabase src/`).
- Files: `package.json`
- Impact: Unnecessary install size and a misleading signal to anyone reading the dependency list that a Supabase integration exists (it doesn't — auth, storage, and DB are MongoDB + AWS S3 + WooCommerce only, per `CLAUDE.md`).
- Fix approach: `npm uninstall @supabase/supabase-js` once confirmed there's no near-term plan to use it.

**Mixed-language comments/logs (Vietnamese + English) across the codebase:**
- Issue: Inline comments and `console.log`/`console.error` strings switch between Vietnamese and English inconsistently, sometimes within the same file (e.g. `src/lib/mongodb.ts` is entirely Vietnamese comments; `src/lib/aws.ts` is entirely English comments; `src/app/api/faces/image/route.ts` mixes both — English module doc comment, Vietnamese inline comments and error strings).
- Files: `src/lib/mongodb.ts`, `src/app/api/upload/route.ts`, `src/app/api/faces/image/route.ts`, `src/app/api/faces/sync/route.ts`, `src/app/api/faces/categories/route.ts` uses no comments, `src/app/api/woocommerce/sync/route.ts`, `src/components/StrapSelector.tsx`, `src/components/FaceUploader.tsx`, `src/app/mobile-upload/page.tsx` (UI strings)
- Impact: Not a functional bug, but raises the bar for any contributor who doesn't read Vietnamese to safely modify these files, and makes `grep`-based auditing (like this one) more error-prone since some error/debug messages won't match English search terms.
- Fix approach: No action required unless the team standardizes on one language for code comments; at minimum, user-facing strings (mobile-upload UI) are a legitimate product decision (Vietnamese-speaking customers) and should stay as-is — this concern applies to internal code comments/logs only.

**Dangling `SYNC_SECRET_KEY` env var, declared but never used:**
- Issue: `src/app/api/woocommerce/sync/route.ts:7` declares `const SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY;` but the variable is never referenced anywhere else in the file — there is no auth check gating the sync route. See also "Unauthenticated destructive sync endpoints" under Security below.
- Files: `src/app/api/woocommerce/sync/route.ts:7`
- Impact: Suggests an auth check was planned or removed but the route was never actually protected; anyone with the URL can trigger the destructive full re-sync (see Security section).
- Fix approach: Either implement the guard (e.g. reject the request unless a header/query param matches `SYNC_SECRET_KEY`) or remove the dead declaration if unauthenticated access is intentional (not recommended — see Security).

**`console.timeEnd` with no matching `console.time`:**
- Issue: `src/app/api/woocommerce/sync/route.ts:93` calls `console.timeEnd("⏱️ Thời gian đồng bộ")` but there is no corresponding `console.time("⏱️ Thời gian đồng bộ")` call anywhere in the file.
- Files: `src/app/api/woocommerce/sync/route.ts:93`
- Impact: Cosmetic only — Node logs a `Warning: No such label` to console instead of a timing value; the sync still completes successfully. Slightly misleading if anyone is relying on this log line to gauge sync duration.
- Fix approach: Add a matching `console.time("⏱️ Thời gian đồng bộ")` at the top of the handler, or remove the orphaned `console.timeEnd` call.

**Verbose raw-data logging in WooCommerce sync:**
- Issue: `src/app/api/woocommerce/sync/route.ts:65` runs `console.dir(products, { depth: null })`, dumping the full raw WooCommerce API response (every product's full attribute/category/tag tree) to logs on every sync, once per page of up to 100 products.
- Files: `src/app/api/woocommerce/sync/route.ts:65`
- Impact: Bloats Vercel function logs (cost/retention implications) and adds real latency to the sync path for no functional benefit; also increases the chance of incidentally logging sensitive-looking data if WooCommerce product data ever includes customer-adjacent fields.
- Fix approach: Remove or gate behind an explicit debug flag (e.g. `if (process.env.DEBUG_SYNC) console.dir(...)`).

## Known Bugs

**No observed functional bugs beyond the above** — the codebase has no automated test suite (see Test Coverage Gaps below), so latent bugs in edge cases (odd strap image aspect ratios, non-standard face crops, concurrent session polling) are plausible but unconfirmed by static reading alone.

## Security Considerations

**Unauthenticated, destructive full-resync endpoints:**
- Risk: `GET /api/woocommerce/sync` (`src/app/api/woocommerce/sync/route.ts`) and `GET /api/faces/sync` (`src/app/api/faces/sync/route.ts`) both perform `collection.deleteMany({})` followed by a bulk re-insert, with no authentication or authorization check on the route at all — any request (a bare `GET` from a browser, a bot, a crawler) triggers the full delete-then-reinsert cycle. There is a brief window mid-sync where `products`/`faces` is empty, which the running app reads live from (`getDatabaseProducts`/`getDatabaseFaces` on every page render — no caching layer in front of MongoDB).
- Files: `src/app/api/woocommerce/sync/route.ts`, `src/app/api/faces/sync/route.ts`, `src/lib/woocommerce.ts` (`getDatabaseProducts`), `src/lib/aws.ts` (`getDatabaseFaces`)
- Current mitigation: None. `SYNC_SECRET_KEY` is declared in `woocommerce/sync/route.ts` but never checked (see Tech Debt above). No rate limiting.
- Recommendations: Gate both routes behind a shared secret (header or query param compared to `process.env.SYNC_SECRET_KEY` / an equivalent for faces) and reject with 401 if missing/mismatched. Also consider making the WooCommerce sync route a `POST` (not a bare `GET`, which is easy to trigger accidentally via a bot crawling links or a browser prefetch) once auth is added.

**Unauthenticated, cost-incurring `/api/generate` endpoint:**
- Risk: `POST /api/generate` calls Replicate's `black-forest-labs/flux-2-pro` model, a paid per-call API (`REPLICATE_API_TOKEN`), with no authentication, no rate limiting, and no per-IP/session throttling. Anyone who discovers the endpoint can script repeated calls and directly run up the project's Replicate bill.
- Files: `src/app/api/generate/route.ts`
- Current mitigation: None beyond `maxDuration = 60` (a Vercel timeout guard, not a cost guard).
- Recommendations: Add basic abuse protection — e.g. rate limit by IP/session (Vercel Edge Config, Upstash Redis, or even a simple in-memory/MongoDB-backed counter), and/or require the request to include a valid `sessionId` that was actually issued by the app flow (currently `strapImage`/`faceImage` can be arbitrary attacker-supplied URLs/base64 with no relation to any real session).

**`/api/generate`'s `strapImage` accepts arbitrary external URLs (server-side fetch, SSRF-shaped surface):**
- Risk: `src/app/api/generate/route.ts:53-56` does `fetch(strapImage)` whenever `strapImage` starts with `http` — this value comes directly from client-submitted JSON with no allowlist of hosts (e.g. not restricted to the WooCommerce CDN domain). A malicious client could pass an internal/metadata URL or an arbitrary external URL, causing the server to fetch it.
- Files: `src/app/api/generate/route.ts:26, 53-56`
- Current mitigation: None — no host allowlist, no protocol restriction beyond the `http` prefix check (which also matches `https`).
- Recommendations: Validate that `strapImage` starts with the known WooCommerce CDN origin before fetching, or resolve it server-side from a trusted product ID/lookup instead of trusting a client-supplied URL directly.

**No env var validation in `src/lib/mongodb.ts` beyond `MONGODB_URI` — inconsistent with `src/lib/aws.ts`'s fail-fast pattern:**
- Risk: `src/lib/mongodb.ts:9-11` does throw early if `MONGODB_URI` is missing (`throw new Error('Vui lòng thêm MONGODB_URI vào file .env.local')`), so this file itself is fine. However, `src/app/api/generate/route.ts` never validates `REPLICATE_API_TOKEN` before constructing `new Replicate({ auth: process.env.REPLICATE_API_TOKEN })` (`src/app/api/generate/route.ts:9-11`), and `src/app/api/woocommerce/sync/route.ts` never validates `WC_CONSUMER_KEY`/`WC_CONSUMER_SECRET`/`WC_BAESE64_KEY` before use — if all three are unset, `getAuthHeaders()` silently builds `Buffer.from('undefined:undefined').toString('base64')` and sends it as a real `Authorization` header, producing a confusing WooCommerce 401 instead of a clear "missing env var" error at startup.
- Files: `src/app/api/generate/route.ts:9-11`, `src/app/api/woocommerce/sync/route.ts:4-13`
- Current mitigation: `src/lib/aws.ts:9-13` is the only integration file with the fail-fast pattern (loops over `['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET']` and throws with a clear message per the file's own comment explaining *why* — to avoid the AWS SDK's cryptic native error).
- Recommendations: Apply the same fail-fast pattern (module-level check, clear error message) to `REPLICATE_API_TOKEN` in `src/app/api/generate/route.ts` and to the WooCommerce credential trio in `src/app/api/woocommerce/sync/route.ts`, so a missing Vercel env var surfaces immediately and legibly instead of as a downstream API error.

**No secrets found hardcoded in source** — `grep` across `src/` for common secret patterns (`AKIA`, `sk-`, inline `Bearer` tokens, inline `api_key =`) found no hardcoded credentials; all API credentials are read from `process.env`. `.env`/`.env.local` files are not committed (not present in the repo tree read during this audit) — verify `.gitignore` covers them before any new deploy target is added.

**`sessions` MongoDB collection has no TTL/expiry and stores raw base64 images:**
- Risk: `POST /api/upload` (`src/app/api/upload/route.ts:29-46`) upserts `{ sessionId, image, createdAt }` into the `sessions` collection with no TTL index and no cleanup job — every mobile-handoff photo ever taken (as a base64 string, i.e. roughly 1.3x the original JPEG size) accumulates in the database indefinitely.
- Files: `src/app/api/upload/route.ts`
- Current mitigation: `createdAt` is stored but nothing reads or acts on it.
- Recommendations: Add a MongoDB TTL index on `sessions.createdAt` (e.g. expire after 24h) so stale handoff sessions are automatically purged — this is a one-line `createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })` addition, mirroring the existing `createIndex` pattern already used in `src/app/api/faces/sync/route.ts:24`.

## Performance Bottlenecks

**`/api/generate` request latency (30-50s) with no caching or precomputation:**
- Problem: Every "Combine" click re-downloads the strap image (or decodes base64), re-resizes 3 separate sharp buffers, and makes a synchronous 30-50s call to Replicate. There is no caching of previously-generated combinations, even for the exact same strap+face pair.
- Files: `src/app/api/generate/route.ts`, `src/components/CombineSection.tsx` (`PROCESSING_STEPS` fake-progress UI compensates for this on the frontend, but doesn't reduce actual latency)
- Cause: FLUX-2-PRO generation time is the dominant cost and is inherent to the model; the `maxDuration = 60` Vercel setting is already close to the model's observed upper bound, leaving little margin before a genuine timeout.
- Improvement path: Not clearly avoidable given the product requirement (all-server-side AI generation per request) — worth watching Vercel timeout headroom if Replicate latency increases; there is no path to cache since faces and strap pairings are effectively unique per customer session.

**Full product/face list fetched and shipped to the client on every page load:**
- Problem: `src/app/page.tsx:10` runs `getDatabaseProducts()` and `getDatabaseFaces()` on every server render with no revalidation/caching directive (no `revalidate` export, no `unstable_cache`), and `StrapSelector`/`FaceLibraryPicker` receive and filter the *entire* catalog client-side (`src/components/StrapSelector.tsx:23-109`, `src/components/FaceLibraryPicker.tsx:16-33`) rather than the server doing search/filter/pagination.
- Files: `src/app/page.tsx`, `src/lib/woocommerce.ts` (`getDatabaseProducts`), `src/lib/aws.ts` (`getDatabaseFaces`), `src/components/StrapSelector.tsx`, `src/components/FaceLibraryPicker.tsx`
- Cause: MongoDB query with no `limit`/pagination — `db.collection('products').find({}).toArray()` and `db.collection('faces').find({}).sort(...).toArray()` both return the entire collection unconditionally.
- Improvement path: As the catalog and face library grow, this will increase both server render time (every request re-queries the full collections) and client-side payload/hydration size. Consider adding a `revalidate` interval on the page (data only changes on manual sync anyway) and/or moving filtering to the server with pagination once collection sizes grow materially past current levels.

## Fragile Areas

**`src/app/api/generate/route.ts` composite geometry (steps 3-5, lines 62-162):**
- Files: `src/app/api/generate/route.ts:62-162`
- Why fragile: The face-placement math (`targetFaceWidth`, `faceTop`, `faceLeft`) is derived from a chain of ratios (`FACE_TO_STRAP_WIDTH_RATIO`, `SHORT_END_TOP_RATIO`) that were tuned against a small number of manually-inspected outputs, not a general formula — per the extensive inline comments, the same ratio that looked correct for one strap/face pairing (python-leather strap + Lange face, called out explicitly in the code comment at line 87) may not generalize to other proportions.
- Safe modification: Any change to these constants should be re-validated visually across multiple strap categories (padded, curved-end, vintage) and multiple face aspect ratios before shipping — there is no automated check that would catch a regression.
- Test coverage: None — this logic has zero unit tests.

**`src/lib/strapProfile.ts` classification heuristics:**
- Files: `src/lib/strapProfile.ts:77-147` (`classifyStrap`), `148-219` (`buildStrapProfileClause`)
- Why fragile: Falls back to regex matching on free-text product names/categories for ~14% of the catalog lacking structured WooCommerce attributes (per the module's own doc comment at lines 1-10). The Habana-padding detection (`habanaBuckleSidePadding`) and Double-vs-Single-padded detection (`doublePadded`) are both documented as having been implemented incorrectly once already and only fixed after a human caught a bad generated image (see comments at `strapProfile.ts:22-31` and `33-37`) — there is no test asserting these classifications stay correct.
- Safe modification: Any change to `classifyStrap` or `buildStrapProfileClause` needs manual verification against real product data (attributes) and, ideally, a real generation test — a silent misclassification (e.g. describing a non-padded strap as padded) directly corrupts the prompt sent to FLUX with no error surfaced anywhere.
- Test coverage: None — no unit tests exist for the classification logic despite it being pure, easily-testable functions with no side effects.

**`FaceUploader.tsx` polling effect (`src/components/FaceUploader.tsx:30-68`):**
- Files: `src/components/FaceUploader.tsx:30-68`
- Why fragile: The `useEffect` generates a new `sessionId` and starts a 2.5s poll loop keyed on `[uploadedImage]` — if `uploadedImage` is cleared and reset in quick succession (e.g. rapid remove/re-upload), a new `sessionId` is minted and a stale QR code showing the old `sessionId` could theoretically still be displayed briefly during a render race, though no confirmed bug was observed. The interval cleanup relies on the effect's return function running correctly on every dependency change.
- Safe modification: Any change to this effect's dependency array or guard conditions (`GUARD 1`/`GUARD 2`/`GUARD 3`, as labeled in the existing comments) needs careful manual testing of the full desktop-QR-scan-mobile-upload-poll cycle, since there's no way to unit-test a live camera + polling flow.
- Test coverage: None.

## Scaling Limits

**MongoDB `sessions` collection grows unbounded** (see Security section above — no TTL index) — at high traffic volumes this becomes a real storage/cost concern, not just a security tidiness issue.

**Full-catalog client-side filtering** (see Performance section above) will degrade as the WooCommerce product catalog or S3 face library grows well beyond current size — no pagination exists at any layer (MongoDB query, API response, or React rendering).

## Dependencies at Risk

**`@supabase/supabase-js` (unused, see Tech Debt above)** — not itself "at risk," but flagged here again because an unused dependency with API-key-shaped env-var conventions (`NEXT_PUBLIC_SUPABASE_*`) is a common source of confusion for future contributors who might assume it's wired up.

**Next.js 16.2.3 / React 19.2.4 (bleeding-edge versions):** — `package.json` pins `"next": "16.2.3"` and `"react": "19.2.4"` / `"react-dom": "19.2.4"`, and `AGENTS.md` explicitly warns: *"This version has breaking changes — APIs, conventions, and file structure may all differ from your training data."* This is a deliberate, acknowledged risk rather than an oversight, but it means any future dependency upgrade or new API usage must be checked against `node_modules/next/dist/docs/` rather than assumed from general Next.js knowledge.

## Missing Critical Features

**No abuse protection / rate limiting anywhere in the API layer** — covered in Security above, listed here too because it blocks safely opening the app to wider/public traffic without a real risk of runaway Replicate spend.

**No output-quality check on `/api/generate` results** — the app cannot detect a structurally broken generation (e.g. forked strap, misplaced case) and silently returns it to the customer as a success. There is no automated or heuristic check; the app's own tuning history (see Tech Debt) proves such breakage happens in practice.

## Test Coverage Gaps

**No test suite is configured at all** (confirmed by `CLAUDE.md`: *"No test suite is currently configured"* — and no `jest.config.*`/`vitest.config.*`/`*.test.*`/`*.spec.*` files exist anywhere in the repo).
- What's not tested: Everything — including pure, easily-testable logic like `classifyStrap`/`buildStrapProfileClause` (`src/lib/strapProfile.ts`), the face-placement geometry math in `/api/generate` (`src/app/api/generate/route.ts`), and the S3 key-to-category derivation (`deriveCategoryAndName` in `src/lib/aws.ts`).
- Files: entire `src/` tree
- Risk: The most consequential business logic (prompt construction driving AI output quality, described extensively in Tech Debt/Fragile Areas above) has already regressed multiple times per its own inline comments, each time only caught by manual human inspection of a generated image, not by any test.
- Priority: High for `src/lib/strapProfile.ts` and the pure geometry math in `src/app/api/generate/route.ts` (both are pure functions, cheap to unit test, and directly gate output quality). Medium for API routes (would require mocking MongoDB/S3/Replicate). Low for UI components given the app's small, single-page surface area.

---

*Concerns audit: 2026-08-04*
