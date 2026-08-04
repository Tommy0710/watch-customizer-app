# Requirements: Watch Customizer — Production Hardening

**Defined:** 2026-08-04
**Core Value:** Every "Combine" click must reliably produce an accurate, correctly-proportioned watch image — the AI generation pipeline is the product's single most important, most fragile piece of logic.

## v1 Requirements

All requirements trace directly to findings in `.planning/codebase/CONCERNS.md`, confirmed with the user during questioning.

### Security

- [ ] **SEC-01**: Sync endpoints (`GET /api/woocommerce/sync`, `GET /api/faces/sync`) reject requests that don't present a valid shared secret before performing their destructive delete-then-reinsert
- [ ] **SEC-02**: `POST /api/generate` rejects requests once a caller (identified by IP/session) exceeds a defined rate limit, tracked via a MongoDB-backed counter (no new external service)
- [ ] **SEC-03**: `/api/generate`'s server-side `strapImage` URL fetch only proceeds for URLs matching the known WooCommerce CDN origin, rejecting arbitrary external/internal URLs

### Cleanup

- [ ] **CLEAN-01**: `src/lib/strapGeometry.ts` (395-line unused module) is removed from the codebase
- [ ] **CLEAN-02**: The dead `mergeImagesWithCanvas` helper and its commented-out call site in `CombineSection.tsx` are removed
- [ ] **CLEAN-03**: The unused `@supabase/supabase-js` dependency is removed from `package.json`

### Testing

- [ ] **TEST-01**: Unit tests (Vitest) cover `classifyStrap` and `buildStrapProfileClause` in `src/lib/strapProfile.ts`, locking in current classification behavior (padded/curved-end/stitch/Habana variants) as a regression guard
- [ ] **TEST-02**: Unit tests (Vitest) cover the pure face-placement geometry math in `src/app/api/generate/route.ts` (target width/position calculations), locking in current proportions as a regression guard

### Reliability

- [ ] **REL-01**: `REPLICATE_API_TOKEN` and the WooCommerce credential trio (`WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `WC_BAESE64_KEY`) fail fast with a clear error at module load if missing, matching the existing pattern in `src/lib/aws.ts`
- [ ] **REL-02**: The `sessions` MongoDB collection has a TTL index so stale mobile-handoff sessions (with their base64 image payloads) automatically expire instead of accumulating indefinitely

### Ops Cleanup

- [ ] **OPS-01**: The orphaned `console.timeEnd` (no matching `console.time`) and the verbose raw-product `console.dir` logging are removed from `src/app/api/woocommerce/sync/route.ts`

## v2 Requirements

Deferred to a future milestone — acknowledged but explicitly out of current roadmap.

### Output Quality

- **QUAL-01**: Detect structurally broken AI-generated output (forked strap, misplaced case) before returning it to the customer

### Scaling

- **SCALE-01**: Server-side pagination/filtering for the product and face catalogs, once catalog size grows materially

## Out of Scope

| Feature | Reason |
|---------|--------|
| UI/visual redesign | User explicitly confirmed the current UI is good as-is; not touching it this milestone |
| Output-quality validation for generated images | No clear automated approach exists yet (FLUX output is inherently stochastic); deferred to v2 as QUAL-01 |
| Full-catalog pagination / server-side filtering | Current catalog size doesn't require it yet; deferred to v2 as SCALE-01 |
| Upstash Redis or other external rate-limit service | Explicitly rejected — reuse existing MongoDB instead, no new paid dependency for a pre-launch app |
| Mixed-language comment/log standardization | Not a functional bug; user-facing Vietnamese strings are a legitimate product decision, not addressed this milestone |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | TBD | Pending |
| SEC-02 | TBD | Pending |
| SEC-03 | TBD | Pending |
| CLEAN-01 | TBD | Pending |
| CLEAN-02 | TBD | Pending |
| CLEAN-03 | TBD | Pending |
| TEST-01 | TBD | Pending |
| TEST-02 | TBD | Pending |
| REL-01 | TBD | Pending |
| REL-02 | TBD | Pending |
| OPS-01 | TBD | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 0
- Unmapped: 11 ⚠️ (roadmap creation pending)

---
*Requirements defined: 2026-08-04*
*Last updated: 2026-08-04 after initial definition*
