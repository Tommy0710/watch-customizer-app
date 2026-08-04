# Phase 1: Security Hardening - Context

**Gathered:** 2026-08-04
**Status:** Ready for planning

<domain>
## Phase Boundary

External requests can no longer trigger destructive syncs, run up the Replicate bill through unmetered calls, or make the server fetch arbitrary attacker-supplied URLs. Covers exactly SEC-01 (sync endpoint auth), SEC-02 (`/api/generate` rate limiting), SEC-03 (`strapImage` origin allowlist). No new capabilities.

</domain>

<decisions>
## Implementation Decisions

### SEC-01 — Sync endpoint shared secret
- **D-01:** Secret passed as a query param (`?key=...`) on both `GET /api/woocommerce/sync` and `GET /api/faces/sync` — keeps them callable by pasting a URL into the browser, no new tooling needed.
- **D-02:** Reuse the existing (currently-read-but-unenforced) `SYNC_SECRET_KEY` env var — no rename.
- **D-03:** Fail-closed: if `SYNC_SECRET_KEY` is unset, the endpoint returns 401 for everyone rather than falling back to open access. This is the current real state of `.env.local` (not set), so the user must add `SYNC_SECRET_KEY` to `.env.local` and Vercel before sync endpoints work again post-phase.

### SEC-02 — `/api/generate` rate limiting
- **D-04:** Limit: 5 requests per 10 minutes, keyed by caller.
- **D-05:** Caller identity = IP address, read from the `x-forwarded-for` header (Vercel-provided). No session-id fallback needed — IP-only.
- **D-06:** Blocked response: HTTP 429, JSON body `{ success: false, error: "<user-friendly Vietnamese-or-English message>" }`, matching `/api/generate`'s existing error-response convention (never leak raw internals to the client).
- **D-07 (Claude's discretion):** Exact wording of the 429 message and MongoDB counter collection/schema are left to the planner/executor — no user preference expressed beyond "matches existing error convention."

### SEC-03 — strapImage origin allowlist
- **D-08:** Allowed origins: `cdn.handdn.com` and `handdn.com` (both allowed, not just the CDN subdomain — observed in code as `https://cdn.handdn.com/...`).
- **D-09:** Rejected origin → reject before fetching, HTTP 400, `{ success: false, error: ... }`, same convention as D-06.

### Claude's Discretion
- Exact MongoDB collection/document shape for the SEC-02 rate-limit counter (e.g. TTL-based vs windowed count) — no user preference stated, just "MongoDB-backed, no new external service" (already locked in PROJECT.md).
- Exact wording of user-facing error messages for all three (429, 400, 401) — user only specified they must follow the existing safe/generic-message convention.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — SEC-01, SEC-02, SEC-03 definitions
- `.planning/ROADMAP.md` §Phase 1 — success criteria this phase must satisfy
- `.planning/PROJECT.md` — constraint: rate-limiting must be MongoDB-backed, no new external service (Upstash/Redis explicitly rejected)

### Code touched by this phase
- `src/app/api/woocommerce/sync/route.ts` — add SEC-01 auth check (also has pending OPS-01 cleanup in Phase 2, not this phase)
- `src/app/api/faces/sync/route.ts` — add SEC-01 auth check
- `src/app/api/generate/route.ts` — add SEC-02 rate limit (before the Replicate call) and SEC-03 origin check (before `fetch(strapImage)` at line ~54)
- `src/lib/mongodb.ts` — singleton MongoDB client to reuse for the SEC-02 counter (don't create a second connection pattern)

No external specs beyond the above — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `clientPromise` from `src/lib/mongodb.ts` — singleton MongoDB client already used by `sessions`/`products`/`faces` collections; reuse for the new rate-limit collection rather than a new connection pattern.
- `src/lib/aws.ts` fail-fast module-load pattern (referenced in PROJECT.md/REQUIREMENTS.md REL-01, Phase 2) — not needed for Phase 1 since `SYNC_SECRET_KEY` fail-closed behavior is a per-request check, not module-load, but worth being consistent in error-message tone.

### Established Patterns
- All API routes wrap handlers in try/catch, always return `NextResponse.json({ success, ... })`, never let exceptions propagate — SEC-01/02/03 checks must return in this same shape.
- `/api/generate` already truncates large payloads in logs (`console.log` with `.slice(0, 40)...(base64)`) — any new logging for rate-limit/auth rejections should follow the same non-verbose convention.

### Integration Points
- SEC-02's rate-limit check must run *before* the Replicate call in `src/app/api/generate/route.ts` (currently starts around line 26, Replicate call happens later in the handler) — success criteria #3 in ROADMAP.md requires rejection before any Replicate spend.
- SEC-03's origin check must run *before* `fetch(strapImage)` at `src/app/api/generate/route.ts:54`.

</code_context>

<specifics>
## Specific Ideas

- Sync endpoints: query param `?key=...`, not header — user explicitly wants browser-URL callability preserved.
- Rate limit: exactly "5 requests / 10 minutes / IP" — user's own number, not a default Claude suggested from nothing (confirmed the recommended option).
- Origin allowlist: both `cdn.handdn.com` and `handdn.com` — user wants the broader pair, not just the CDN subdomain, in case product images move to the main domain later.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (SEC-01/02/03 only, no scope creep raised).

</deferred>

---

*Phase: 1-Security Hardening*
*Context gathered: 2026-08-04*
