# Roadmap: Watch Customizer — Production Hardening

## Overview

This is a brownfield hardening milestone for an existing, working demo app — no new user-facing features. The 11 v1 requirements cluster into four natural concern boundaries: close the security holes that matter most before any wider traffic (destructive unauthenticated sync endpoints, unmetered paid AI endpoint, SSRF-shaped fetch), then make configuration and stale-data failures loud and self-cleaning (env var validation, session TTL, log noise), then lock in the AI pipeline's historically-regression-prone pure logic with a real test suite, and finally remove dead code/dependencies now that a regression guard exists to catch any accidental fallout from deletion.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Security Hardening** - Sync endpoints, `/api/generate`, and the strap-image fetch are no longer open to unauthenticated abuse
- [ ] **Phase 2: Reliability & Operational Safety** - Missing env vars fail fast, stale sessions auto-expire, sync logging is clean
- [ ] **Phase 3: Regression-Guard Test Coverage** - Pure classification and geometry logic behind AI prompt construction is unit-tested
- [ ] **Phase 4: Dead Code & Dependency Cleanup** - Unused module, dead helper, and unused dependency are removed

## Phase Details

### Phase 1: Security Hardening
**Goal**: External requests can no longer trigger destructive syncs, run up the Replicate bill through unmetered calls, or make the server fetch arbitrary attacker-supplied URLs.
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. An unauthenticated `GET /api/woocommerce/sync` request returns 401 and does not delete or reinsert any data.
  2. An unauthenticated `GET /api/faces/sync` request returns 401 and does not delete or reinsert any data.
  3. Once a caller (by IP/session) exceeds the defined request rate on `POST /api/generate`, further requests are rejected before any Replicate call is made.
  4. A `POST /api/generate` request whose `strapImage` URL is outside the known WooCommerce CDN origin is rejected before the server fetches it.
**Plans**: TBD

### Phase 2: Reliability & Operational Safety
**Goal**: Missing required configuration fails immediately and legibly instead of producing confusing downstream errors, and stale mobile-handoff data no longer accumulates indefinitely.
**Depends on**: Phase 1
**Requirements**: REL-01, REL-02, OPS-01
**Success Criteria** (what must be TRUE):
  1. Starting the app (or the first invocation touching `/api/generate`) with `REPLICATE_API_TOKEN` unset throws a clear error at module load instead of failing downstream inside the Replicate call.
  2. Invoking `/api/woocommerce/sync` with any of `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, or `WC_BAESE64_KEY` unset throws a clear error instead of sending a malformed `Authorization` header to WooCommerce.
  3. A document inserted into the `sessions` MongoDB collection is automatically removed after the configured TTL window, confirmed via the collection's index list showing an `expireAfterSeconds` TTL index.
  4. Running `/api/woocommerce/sync` no longer logs the orphaned `console.timeEnd` warning or the full raw-product `console.dir` dump.
**Plans**: TBD

### Phase 3: Regression-Guard Test Coverage
**Goal**: The pure, historically fragile logic that drives AI prompt construction (strap classification and face-placement geometry) is protected by an automated regression suite, locking in current behavior without changing it.
**Depends on**: Phase 2
**Requirements**: TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. A Vitest suite exists and passes for `classifyStrap`, covering the padded/curved-end/stitch/Habana variants documented in `src/lib/strapProfile.ts`.
  2. A Vitest suite exists and passes for `buildStrapProfileClause`, asserting the expected prompt clause for each classified strap type.
  3. A Vitest suite exists and passes for the pure face-placement geometry math (target width/position calculations) in `src/app/api/generate/route.ts`, asserting current proportions.
  4. `npm run test` runs all added suites successfully against unmodified production logic — no constants or prompt text changed to make tests pass.
**Plans**: TBD

### Phase 4: Dead Code & Dependency Cleanup
**Goal**: The codebase contains no unused modules, dead helper functions, or unused dependencies that could mislead a future contributor about what's actually wired into the app — with the Phase 3 test suite as a safety net confirming nothing load-bearing was removed.
**Depends on**: Phase 3
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. `src/lib/strapGeometry.ts` no longer exists in the repo, and `npm run build`, `npm run lint`, and `npm run test` all still pass.
  2. `mergeImagesWithCanvas` and its commented-out call site no longer exist in `CombineSection.tsx`, and the Combine flow still works end-to-end (strap + face → generated image).
  3. `@supabase/supabase-js` no longer appears in `package.json` or `package-lock.json`, and `npm run build` still passes.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Hardening | 0/TBD | Not started | - |
| 2. Reliability & Operational Safety | 0/TBD | Not started | - |
| 3. Regression-Guard Test Coverage | 0/TBD | Not started | - |
| 4. Dead Code & Dependency Cleanup | 0/TBD | Not started | - |
