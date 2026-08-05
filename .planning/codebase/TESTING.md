# Testing Patterns

**Analysis Date:** 2026-08-04

## Test Framework

**Runner:**
- None. No test runner is installed or configured. Verified: `package.json` `dependencies`/`devDependencies` contain no `jest`, `vitest`, `mocha`, `@testing-library/*`, `playwright`, or `cypress`. No `jest.config.*`, `vitest.config.*`, or `playwright.config.*` file exists anywhere in the repo.
- No `test` script in `package.json` — only `dev`, `build`, `start`, `lint`.
- A full `find . -name "*.test.*" -o -name "*.spec.*"` scan (excluding `node_modules`/`.git`) returned zero results.
- This confirms the statement in `CLAUDE.md`: "No test suite is currently configured." — still accurate as of this analysis.

**Assertion Library:**
- Not applicable — none present.

**Run Commands:**
```bash
# No test command exists. Available scripts (package.json):
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build (also runs TypeScript's type-check via Next.js build)
npm run lint     # ESLint check only
```

## Test File Organization

**Location:** Not applicable — no test files exist.

**Naming:** Not applicable.

**Structure:** Not applicable.

## Test Structure

Not applicable — no test suites exist anywhere in the codebase.

## Mocking

**Framework:** None.

**What would need mocking if tests were added:**
- MongoDB: `src/lib/mongodb.ts` exports a singleton `clientPromise`; any DB-touching code (`getDatabaseProducts` in `src/lib/woocommerce.ts`, `getDatabaseFaces` in `src/lib/aws.ts`, both API routes in `src/app/api/upload/route.ts` and `src/app/api/faces/sync/route.ts`) would need this client mocked or a test database.
- AWS S3: `src/lib/aws.ts` constructs an `S3Client` at module load time and throws if required env vars are missing — this module cannot be imported in a test environment without either setting `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_S3_BUCKET` env vars or mocking `@aws-sdk/client-s3` before import.
- Replicate: `src/app/api/generate/route.ts` calls `replicate.run(...)` directly against the live `black-forest-labs/flux-2-pro` model — this is a paid, slow (30-50s), non-deterministic external call that would need mocking for any automated test of the generate pipeline.
- `sharp`: heavily used for image resize/composite in `src/app/api/generate/route.ts` and `src/lib/aws.ts` (`getThumbnailBuffer`) — real image buffers would need to be fixture files if testing this logic directly rather than mocking `sharp` itself, since its output shape (dimensions after `fit: 'inside'`) is part of the logic being tested.
- WooCommerce REST client: `@woocommerce/woocommerce-rest-api` used in the sync route (`src/app/api/woocommerce/sync/route.ts`, not fully read here but implied by `CLAUDE.md`'s route table) — would need HTTP mocking (e.g. nock/msw) or a stubbed client.

**What NOT to mock (if introducing tests):**
- Pure classification/formatting logic has zero external dependencies and is the best first target for unit tests without any mocking: `classifyStrap` and `buildStrapProfileClause` in `src/lib/strapProfile.ts`, `deriveCategoryAndName` in `src/lib/aws.ts` (the category-derivation function itself, not `listAllFaceKeys`/`getObjectBuffer` which touch S3).

## Fixtures and Factories

Not applicable — none exist. If introduced, `src/lib/strapProfile.ts`'s `classifyStrap` inputs (`name: string`, `categoryNames: string[]`, `attributes: Attribute[]`) mirror real WooCommerce product shapes (`Product` type in `src/lib/woocommerce.ts`) and would make natural fixture objects, given the comment in `strapProfile.ts` noting ~86% of the catalog has real attributes vs. ~14% relying on name/category regex fallback — both cases should be covered by fixtures.

## Coverage

**Requirements:** None enforced — no coverage tool configured.

**View Coverage:**
```bash
# Not applicable — no coverage tooling installed.
```

## Test Types

**Unit Tests:** Not used.

**Integration Tests:** Not used.

**E2E Tests:** Not used. No Playwright/Cypress config or `e2e/` directory found.

**Manual verification path (current de facto testing approach):**
1. `npm run dev`, exercise the desktop flow: pick a strap in `StrapSelector` (`src/components/StrapSelector.tsx`), provide a face via upload/QR/library (`FaceUploader.tsx`, `FaceLibraryPicker.tsx`), click Combine (`CombineSection.tsx`) and visually inspect the Replicate output.
2. Cross-device flow requires a second physical device or browser session hitting `/mobile-upload?session=<id>` (`src/app/mobile-upload/page.tsx`) to test the QR handoff + polling loop (`GET /api/upload?sessionId=`).
3. Tuning changes to the FLUX prompt/image pipeline in `src/app/api/generate/route.ts` are validated by running a real generation and eyeballing the result — this is the origin of the extensive tuning-history comments documented in `CONVENTIONS.md` (e.g. `FACE_TO_STRAP_WIDTH_RATIO`, `SHORT_END_TOP_RATIO`). There is no automated regression check for image-pipeline changes; any future change to these constants should be manually re-verified against representative strap/face pairs before merging.

## Common Patterns

**Async Testing:** Not applicable — no test infrastructure exists to demonstrate a pattern.

**Error Testing:** Not applicable.

## Recommendations if Introducing Tests

- Add `vitest` (lighter weight, native ESM/TS support, fast) or `jest` with `ts-jest`/SWC, plus a `test` script in `package.json`.
- Start with pure-function unit tests for `src/lib/strapProfile.ts` (`classifyStrap`, `buildStrapProfileClause`, `classifyThickness`) and `deriveCategoryAndName` in `src/lib/aws.ts` — these have no I/O and directly encode business rules that are easy to regress silently (e.g. the habana-padding direction bug mentioned in `src/lib/strapProfile.ts`'s comments).
- For API routes, prefer testing the pure logic they call rather than the Next.js route handlers directly, since routes are tightly coupled to live MongoDB/S3/Replicate calls; alternatively use `msw`/`nock` to stub `fetch` and the AWS/Replicate SDKs.
- Do not attempt to unit-test the FLUX prompt/image proportions numerically — the tuning history in `src/app/api/generate/route.ts` shows these were derived empirically against real model output, not from a formula; any test of that logic would only be able to assert the arithmetic (e.g. `targetFaceWidth = strapResizedWidth * FACE_TO_STRAP_WIDTH_RATIO`), not visual correctness.

---

*Testing analysis: 2026-08-04*
