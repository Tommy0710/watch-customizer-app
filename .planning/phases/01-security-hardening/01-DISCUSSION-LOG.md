# Phase 1: Security Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-04
**Phase:** 1-Security Hardening
**Areas discussed:** Sync endpoint secret (SEC-01), Rate limit design (SEC-02), strapImage origin check (SEC-03)

---

## Sync endpoint secret (SEC-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Query param `?key=...` | Simplest, still callable directly via browser/URL as today | ✓ |
| Header `x-sync-secret` | More secure (not leaked in URL/access logs), but no longer callable by pasting a URL into the browser | |

**User's choice:** Query param `?key=...`
**Notes:** User wants to preserve the current "paste URL into browser" workflow for admin-triggered syncs.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `SYNC_SECRET_KEY` | Code already reads this env var (currently unused/unenforced) — no rename needed | ✓ |
| Different name | User specifies a preferred variable name | |

**User's choice:** Reuse `SYNC_SECRET_KEY`

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed (401 if unset) | If `SYNC_SECRET_KEY` isn't set, endpoint is locked for everyone — matches "harden security" intent | ✓ |
| Fail-open (allow if unset) | Preserves current open behavior when secret isn't configured — not recommended | |

**User's choice:** Fail-closed, 401 if unset
**Notes:** User acknowledged `SYNC_SECRET_KEY` isn't currently in `.env.local` and will need to add it after this phase to keep using sync.

---

## Rate limit design (SEC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| 5 requests / 10 min / IP | Matches Replicate's real per-call cost and duration (30-50s) — enough for a customer trying a few strap/face combos, blocks scripted abuse | ✓ |
| Other threshold | User specifies a different number/window | |

**User's choice:** 5 requests / 10 minutes / IP

| Option | Description | Selected |
|--------|-------------|----------|
| IP address via `x-forwarded-for` | Simple, no client changes needed | ✓ |
| IP + reject if undetermined | Fail-closed if IP can't be resolved — safer but risks false blocks behind odd proxies | |

**User's choice:** IP address via `x-forwarded-for`

**Notes:** Response format (429 + `{ success: false, error }`) was presented as a single clear default matching `/api/generate`'s existing error convention — no genuine second option existed, so it wasn't put to a formal choice; confirmed as the direction going forward.

---

## strapImage origin check (SEC-03)

| Option | Description | Selected |
|--------|-------------|----------|
| `cdn.handdn.com` + `handdn.com` | Matches the real domain seen in code, plus the parent domain in case images move there | ✓ |
| `cdn.handdn.com` only | Narrower, matches exactly what's observed today | |

**User's choice:** `cdn.handdn.com` + `handdn.com`

**Notes:** Rejection behavior (400 + `{ success: false, error }`, matching existing convention) was presented as a single clear default — no genuine second option, confirmed as direction.

---

## Claude's Discretion

- Exact MongoDB collection/document shape for the SEC-02 rate-limit counter.
- Exact wording of all three error messages (401, 429, 400) — must stay generic/safe per existing convention, exact phrasing left to executor.

## Deferred Ideas

None — discussion stayed within phase scope.
