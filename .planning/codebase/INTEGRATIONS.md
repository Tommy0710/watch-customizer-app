# External Integrations

**Analysis Date:** 2026-08-04

## APIs & External Services

**AI Image Generation:**
- Replicate (`replicate` npm SDK `^1.4.0`) - runs `black-forest-labs/flux-2-pro` to composite a watch face onto a strap
  - SDK/Client: `Replicate` instantiated in `src/app/api/generate/route.ts`
  - Auth: `REPLICATE_API_TOKEN` env var
  - Called with 3 reference images (`draftCompositeDataUri`, `strapReferenceDataUri`, `faceReferenceDataUri`), all built server-side with `sharp` and base64-encoded as PNG data URIs (not sent as separate uploads)
  - Has a one-time automatic retry in-code for Replicate's `E005 "flagged as sensitive"` false-positive error (see route.ts lines ~183-194)
  - Route sets `export const maxDuration = 60` because generation calls take 30-50s and would otherwise hit Vercel's default function timeout

**E-commerce Product Source:**
- WooCommerce REST API on `handdn.com` - source of truth for the strap product catalog
  - Endpoint: `https://handdn.com/wp-json/wc/v3/products` (hardcoded in `src/app/api/woocommerce/sync/route.ts`)
  - Client: raw `fetch`, not the installed `@woocommerce/woocommerce-rest-api` SDK (that dependency is unused)
  - Auth: HTTP Basic Auth header built from either `WC_BAESE64_KEY` directly, or `Buffer.from(WC_CONSUMER_KEY:WC_CONSUMER_SECRET).toString('base64')` as a fallback
  - Sync is a manual pull: `GET /api/woocommerce/sync` paginates through all products (100/page, filtered to `status=publish`, `stock_status=instock`), then does a full delete-all + insert-all into MongoDB `products` — not incremental, no webhook push from WooCommerce

## Data Storage

**Databases:**
- MongoDB (Atlas or self-hosted — connection string only, no provider-specific code) via `mongodb` driver `^7.1.1`
  - Connection: `MONGODB_URI` env var, singleton client in `src/lib/mongodb.ts` (dev: cached on `global` to survive Next.js hot-reload; prod: fresh client per cold start)
  - Database name: `watch_customizer` (hardcoded string in every file that opens a collection — `src/lib/woocommerce.ts`, `src/lib/aws.ts`, `src/app/api/upload/route.ts`, `src/app/api/faces/image/route.ts`, `src/app/api/faces/sync/route.ts`, `src/app/api/woocommerce/sync/route.ts`)
  - Collections:
    - `products` - strap catalog, fully replaced on each `GET /api/woocommerce/sync` call
    - `sessions` - temporary desktop↔mobile handoff records (`sessionId`, `image`, `createdAt`), upserted by `POST /api/upload`, polled by `GET /api/upload?sessionId=`. No TTL index observed in code — sessions are not automatically expired/cleaned up.
    - `faces` - S3 face-library metadata mirror (`key`, `name`, `category` only, no image bytes), fully replaced on each `GET /api/faces/sync` call; has a unique index on `key` created in `src/app/api/faces/sync/route.ts`

**File Storage:**
- AWS S3 - bucket `AWS_S3_BUCKET`, holds the watch-face photo library ("watch-face-handdn" per `CLAUDE.md`)
  - Client: `@aws-sdk/client-s3` `^3.1087.0` in `src/lib/aws.ts` (`S3Client`, `ListObjectsV2Command`, `GetObjectCommand`)
  - Auth: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — module throws at import time if any are missing (fail-fast, see `src/lib/aws.ts` lines 9-13)
  - Key convention: `<AWS_S3_FACES_PREFIX>/<category>/<file>`; first path segment after the prefix becomes the category, validated against a hardcoded `VALID_BRANDS` set (~90 watch brand slugs) in `deriveCategoryAndName()` — anything not in that set (including the known-bad `a` stray folder) falls back to category `"Others"`
  - Bucket is never public: the client never talks to S3 directly. Both thumbnails and full-resolution face images are streamed through `GET /api/faces/image?key=` (`src/app/api/faces/image/route.ts`), which first validates the `key` exists in the MongoDB `faces` collection before fetching from S3, then serves it with a 1-year immutable `Cache-Control` header
  - `getThumbnailBuffer()` in `src/lib/aws.ts` produces a resized 240px JPEG (quality 80) for the picker grid; `/api/generate` always uses `getObjectBuffer()` (full resolution), never the thumbnail path

**Caching:**
- No application-level cache service (no Redis, no in-memory cache library). The only caching is HTTP-layer: `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable` on `GET /api/faces/image`, which lets Vercel's edge cache absorb repeat requests for the same S3 key.

## Authentication & Identity

**Auth Provider:**
- None implemented. No login/session/user-auth code found anywhere in `src/`.
- `AUTH_TRUST_HOST` exists in `.env.local` (suggests a NextAuth/Auth.js var name) but has zero references in `src/` — dead/leftover config, not an active integration.
- The only "auth" in the codebase is service-to-service: WooCommerce Basic Auth (outbound) and the unused `SYNC_SECRET_KEY` constant in `src/app/api/woocommerce/sync/route.ts` (declared but never checked against an incoming request — the sync route is currently unauthenticated/publicly callable by anyone who knows the URL).

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry/Bugsnag/etc. dependency or integration found.

**Logs:**
- `console.log`/`console.error`/`console.warn` only, scattered through API routes and `src/lib/`. Many logs are in Vietnamese and use emoji prefixes (`⏳`, `✅`, `❌`, `🔌`, `🚀`, `🛠️`) as a de facto log-level convention — grep for these when debugging production logs on Vercel.
- `src/app/api/generate/route.ts` deliberately truncates base64 payloads in logs (`strapImage.slice(0, 40)}...(base64)`) to avoid dumping full image data into logs.

## CI/CD & Deployment

**Hosting:**
- Vercel (inferred from `maxDuration` exports and `CLAUDE.md`; no other hosting config found — no `Dockerfile`, no `vercel.json` present in repo root)

**CI Pipeline:**
- None found. No `.github/workflows/`, no other CI config in the repo.

## Environment Configuration

**Required env vars (actively used in code):**
- `MONGODB_URI` - `src/lib/mongodb.ts`
- `REPLICATE_API_TOKEN` - `src/app/api/generate/route.ts`
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` - `src/lib/aws.ts` (fail-fast if missing)
- `AWS_S3_FACES_PREFIX` - `src/lib/aws.ts` (optional, defaults to `''`)
- `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `WC_BAESE64_KEY` - `src/app/api/woocommerce/sync/route.ts` (typo in `WC_BAESE64_KEY` is intentional/existing, not a documentation error)

**Declared but unused (present in `.env.local` or referenced in code with no effect):**
- `AI_API_KEY` - in `.env.local`, no code references found
- `AUTH_TRUST_HOST` - in `.env.local`, no code references found
- `SYNC_SECRET_KEY` - referenced in `src/app/api/woocommerce/sync/route.ts` but never enforced (no auth check using it), and not present in local `.env.local`

**Secrets location:**
- Local: `.env.local` (gitignored via the blanket `.env*` rule in `.gitignore`)
- Production: Vercel project environment variables (Vercel does not read `.env.local`)

## Webhooks & Callbacks

**Incoming:**
- None. All syncs (`GET /api/woocommerce/sync`, `GET /api/faces/sync`) are manually triggered pulls, not webhook-driven pushes from WooCommerce or S3.

**Outgoing:**
- None beyond the request/response API calls already covered above (Replicate, WooCommerce REST, S3). No outbound webhook notifications sent by this app.

---

*Integration audit: 2026-08-04*
