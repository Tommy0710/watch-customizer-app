# Watch Customizer — Production Hardening

## What This Is

A Next.js App Router app where customers pick a leather watch strap, upload or pick a face photo, and get an AI-generated composite (FLUX-2-PRO via Replicate) showing the assembled watch. Currently a working demo/internal-test app, not yet live to real customers.

## Core Value

Every "Combine" click must reliably produce an accurate, correctly-proportioned watch image — the AI generation pipeline (`src/app/api/generate/route.ts`, `src/lib/strapProfile.ts`) is the product's single most important, most fragile piece of logic.

## Requirements

### Validated

- ✓ Desktop strap selection from MongoDB-synced WooCommerce catalog — existing
- ✓ Face input via drag-drop crop, QR/mobile handoff, or S3 face library picker — existing
- ✓ AI composite generation via Replicate FLUX-2-PRO with 3-reference-image pipeline — existing
- ✓ Strap construction classification (padded/curved-end/stitch/Habana variants) driving prompt accuracy — existing, tuned through many iterations

### Active

- [ ] Sync endpoints (`GET /api/woocommerce/sync`, `GET /api/faces/sync`) require a shared-secret check before performing their destructive delete-then-reinsert
- [ ] `POST /api/generate` is rate-limited per IP/session using MongoDB-backed request counting (no new external service)
- [ ] Dead code removed: `src/lib/strapGeometry.ts` (395 lines, unused), `mergeImagesWithCanvas` in `CombineSection.tsx`, unused `@supabase/supabase-js` dependency
- [ ] Unit tests (Vitest) cover `classifyStrap`/`buildStrapProfileClause` (`src/lib/strapProfile.ts`) and the pure geometry math in `/api/generate/route.ts`
- [ ] Fail-fast env var validation added for `REPLICATE_API_TOKEN` and the WooCommerce credential trio, matching the existing pattern in `src/lib/aws.ts`
- [ ] `sessions` MongoDB collection gets a TTL index so stale mobile-handoff sessions auto-expire
- [ ] `/api/generate`'s `strapImage` URL fetch is restricted to the known WooCommerce CDN origin (closes the SSRF-shaped open fetch)
- [ ] Orphaned `console.timeEnd` and verbose raw-product `console.dir` logging removed from the WooCommerce sync route

### Out of Scope

- UI/visual redesign — user explicitly confirmed the current UI is fine as-is; not touching it this milestone
- Output-quality validation for generated images (detecting a structurally broken watch) — no clear automated approach exists yet; deferred, flagged as a known gap
- Full-catalog pagination / server-side filtering — current catalog size doesn't require it yet, revisit if it grows materially
- Switching rate-limiting to Upstash Redis or another external service — explicitly rejected in favor of reusing existing MongoDB

## Context

- App is in a pre-launch/internal-test state — no real customer traffic yet, so this hardening work is preventive, done before opening the app up rather than in response to an incident.
- A full codebase map exists at `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS), generated immediately before this project — all Active requirements above trace directly to findings in `CONCERNS.md`.
- The AI generation pipeline has a documented history of regressions from manually-tuned magic constants (`STRAP_MAX_DIMENSION`, `FACE_TO_STRAP_WIDTH_RATIO`, `SHORT_END_TOP_RATIO`, `FACE_DETAIL_WIDTH_RATIO` in `src/app/api/generate/route.ts`) and prompt-clause logic (`src/lib/strapProfile.ts`) — several past bugs were only caught by a human eyeballing a bad generated image. This is why unit tests target exactly the pure, testable parts of that logic (classification + geometry math), not the AI call itself, which is inherently stochastic and can't be unit tested.
- No test suite currently exists anywhere in the repo (confirmed via `CONVENTIONS.md`/`TESTING.md`).
- `src/lib/aws.ts` already has a fail-fast env-var validation pattern (throws a clear error at module load if a required AWS var is missing) — this is the pattern to replicate for Replicate/WooCommerce credentials, not a new pattern to invent.

## Constraints

- **Tech stack**: Next.js 16.2.3 / React 19.2.4 (bleeding-edge; per `AGENTS.md`, API behavior may differ from training data — verify against `node_modules/next/dist/docs/` before using unfamiliar APIs) — existing, not renegotiable this milestone.
- **No new external services**: rate-limiting must use MongoDB (already in the stack), not Upstash/Redis — explicit user decision to avoid adding a new paid dependency for a pre-launch app.
- **Test framework**: Vitest — user's explicit choice over Jest for Next.js 16/React 19 compatibility and setup simplicity.
- **UI is frozen**: no visual/layout changes this milestone, regardless of what refactoring touches nearby files.
- **AI pipeline behavior must not regress**: any refactor touching `src/app/api/generate/route.ts` or `src/lib/strapProfile.ts` must preserve exact current prompt/constant values unless a requirement explicitly calls for changing them (none do this milestone) — tests should lock in current behavior, not change it.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rate-limit via MongoDB counter, not Upstash Redis | Reuses existing infra, no new service/cost for a pre-launch app | — Pending |
| Vitest over Jest | Simpler setup with Next.js 16 App Router + React 19, faster | — Pending |
| UI excluded from this milestone entirely | User confirmed current UI is already good; hardening is the priority | — Pending |
| Unit tests target pure logic only (classification + geometry math), not the Replicate call itself | The AI call is inherently stochastic — can't be meaningfully unit tested; the pure functions around it can and have regressed before | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-04 after initialization*
