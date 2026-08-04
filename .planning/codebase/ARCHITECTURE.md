<!-- refreshed: 2026-08-04 -->
# Architecture

**Analysis Date:** 2026-08-04

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                  Desktop Page (Server Component)                     │
│                       `src/app/page.tsx`                             │
│  Fetches products + faces at render time, no client fetch on load    │
├──────────────────────┬──────────────────────┬────────────────────────┤
│   StrapSelector       │   FaceUploader        │   CombineSection       │
│  `src/components/     │  `src/components/     │  `src/components/     │
│   StrapSelector.tsx`  │   FaceUploader.tsx`   │   CombineSection.tsx` │
│  (client component)   │  (client component,   │  (client component)   │
│                        │   wraps               │                       │
│                        │   FaceLibraryPicker)  │                       │
└──────────┬─────────────┴──────────┬─────────────┴───────────┬──────────┘
           │                        │                         │
           │ setSelectedStrap()     │ setUploadedFace()        │ reads both
           ▼                        ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Zustand Store (client-side only)                    │
│                    `src/store/useAppStore.ts`                        │
│           { selectedStrap: Product | null,                           │
│             uploadedFace: string | null }                            │
└─────────────────────────────────────────────────────────────────────┘
           │
           │ Combine button → POST /api/generate
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 API Routes (server logic, no separate backend)       │
│                        `src/app/api/**/route.ts`                     │
│  /api/upload, /api/generate, /api/faces/*, /api/woocommerce/sync     │
└───────┬───────────────┬──────────────────┬──────────────┬────────────┘
        │                │                  │              │
        ▼                ▼                  ▼              ▼
┌───────────────┐ ┌──────────────┐ ┌────────────────┐ ┌──────────────┐
│   MongoDB      │ │   AWS S3      │ │   Replicate     │ │  WooCommerce  │
│ `src/lib/      │ │ `src/lib/     │ │  API (FLUX-2-   │ │  REST API     │
│  mongodb.ts`   │ │  aws.ts`      │ │  PRO)           │ │  (handdn.com) │
│ products/      │ │ face library  │ │ inline in       │ │ inline in     │
│ sessions/faces │ │ bucket        │ │ generate route  │ │ sync route    │
└───────────────┘ └──────────────┘ └────────────────┘ └──────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `CustomizerApp` (page) | Server-fetches strap + face catalogs, lays out the 3-column desktop UI | `src/app/page.tsx` |
| `StrapSelector` | Client-side filter/search over the server-fetched `Product[]`, writes selection to store | `src/components/StrapSelector.tsx` |
| `FaceUploader` | Orchestrates 3 face-input paths (drag-drop, QR/mobile poll, S3 library), owns crop UI | `src/components/FaceUploader.tsx` |
| `FaceLibraryPicker` | Search/filter grid over server-fetched `FaceItem[]`, thumbnails proxied through `/api/faces/image` | `src/components/FaceLibraryPicker.tsx` |
| `CombineSection` | Reads both store fields, POSTs to `/api/generate`, renders progress/result | `src/components/CombineSection.tsx` |
| `MobileUploadPage` | Standalone route for phone camera capture, POSTs cropped photo to `/api/upload` | `src/app/mobile-upload/page.tsx` |
| `useAppStore` | Global client state: `selectedStrap`, `uploadedFace` only | `src/store/useAppStore.ts` |
| `/api/generate` | Builds 3 sharp-processed reference images, calls Replicate FLUX-2-PRO | `src/app/api/generate/route.ts` |
| `/api/upload` | MongoDB `sessions` upsert (POST) / poll (GET) for desktop↔mobile handoff | `src/app/api/upload/route.ts` |
| `/api/faces/*` | S3 face library read paths: list categories, stream/thumbnail an image, full resync | `src/app/api/faces/{categories,image,sync}/route.ts` |
| `/api/woocommerce/sync` | Full re-sync of WooCommerce catalog into MongoDB `products` | `src/app/api/woocommerce/sync/route.ts` |
| `getDatabaseProducts` | Reads `products` collection, shapes into `Product` type | `src/lib/woocommerce.ts` |
| `getDatabaseFaces` / `listAllFaceKeys` / `getObjectBuffer` | S3 listing + MongoDB `faces` catalog + S3 object fetch | `src/lib/aws.ts` |
| `classifyStrap` / `buildStrapProfileClause` | Derives strap construction facts (padded, curved, stitch, etc.) from WooCommerce attributes, builds an extra FLUX prompt clause | `src/lib/strapProfile.ts` |
| `clientPromise` | Singleton MongoDB client (dev hot-reload safe) | `src/lib/mongodb.ts` |
| `getCroppedImg` | Canvas-based crop utility used by `react-easy-crop` output | `src/utils/cropImage.ts` |

## Pattern Overview

**Overall:** Next.js App Router monolith — no separate backend service. Server Components fetch data at render time (`page.tsx`); all mutation/generation logic lives in Route Handlers under `src/app/api/`. There is no ORM/repository layer — route handlers and `src/lib/*.ts` call the MongoDB driver, AWS SDK, and Replicate SDK directly.

**Key Characteristics:**
- Single Server Component entry point (`page.tsx`) does the only server-side data fetch on initial load; everything downstream is client components communicating through one small Zustand store.
- No REST/GraphQL API layer between client and DB — API routes are thin, purpose-built endpoints (upload/poll, generate, sync, image proxy), not a generic CRUD API.
- Cross-device handoff (desktop ↔ mobile) is implemented via a polling MongoDB document (`sessions` collection) instead of WebSockets/SSE.
- Third-party catalogs (WooCommerce products, S3 face photos) are pulled into MongoDB via manual "full sync" endpoints (delete-all + reinsert) rather than queried live on each request — MongoDB is the read path for the UI, not a cache in front of live APIs.
- Image processing (resize/composite/encode) is done server-side with `sharp` inside the `/api/generate` route handler itself — no separate image-processing service or serverless function.

## Layers

**Presentation (Server Component entry):**
- Purpose: initial data fetch + page shell
- Location: `src/app/page.tsx`, `src/app/layout.tsx`
- Contains: async Server Component, font/metadata setup
- Depends on: `src/lib/woocommerce.ts`, `src/lib/aws.ts`
- Used by: Next.js router

**Presentation (Client components):**
- Purpose: interactive UI — filtering, cropping, polling, triggering generation
- Location: `src/components/*.tsx`, `src/app/mobile-upload/page.tsx`
- Contains: `'use client'` React components, local `useState`/`useEffect` state
- Depends on: `useAppStore`, `/api/*` fetch calls, `src/utils/cropImage.ts`
- Used by: `src/app/page.tsx`, Next.js router (mobile-upload)

**State (client-global):**
- Purpose: share `selectedStrap`/`uploadedFace` between sibling components without prop drilling
- Location: `src/store/useAppStore.ts`
- Contains: one Zustand `create()` store, no persistence/middleware
- Depends on: `src/lib/woocommerce.ts` (`Product` type only)
- Used by: `StrapSelector`, `FaceUploader`, `CombineSection`

**API / server logic:**
- Purpose: all server-side mutation and third-party integration work
- Location: `src/app/api/**/route.ts`
- Contains: Next.js Route Handlers (`GET`/`POST` exports), no shared controller abstraction
- Depends on: `src/lib/mongodb.ts`, `src/lib/aws.ts`, `src/lib/strapProfile.ts`, `sharp`, `replicate` SDK
- Used by: client components via `fetch`, and directly via browser for sync endpoints

**Data access (`src/lib/`):**
- Purpose: encapsulate MongoDB/S3/classification logic reused by route handlers and the page
- Location: `src/lib/mongodb.ts`, `src/lib/woocommerce.ts`, `src/lib/aws.ts`, `src/lib/strapProfile.ts`, `src/lib/strapGeometry.ts`
- Contains: typed helper functions (`getDatabaseProducts`, `getDatabaseFaces`, `getObjectBuffer`, `classifyStrap`), no classes
- Depends on: `mongodb`, `@aws-sdk/client-s3`, `sharp` npm packages
- Used by: `src/app/page.tsx`, API routes

**External services:**
- MongoDB Atlas (`watch_customizer` DB — collections `products`, `sessions`, `faces`)
- AWS S3 (`watch-face-handdn` bucket, face photo library)
- Replicate (`black-forest-labs/flux-2-pro` model)
- WooCommerce REST API on `handdn.com` (source of truth for strap products, pulled via `/api/woocommerce/sync`)

## Data Flow

### Primary "Combine" Path (desktop, drag-drop face)

1. Server render: `getDatabaseProducts()` + `getDatabaseFaces()` run in parallel (`src/app/page.tsx:10`)
2. User picks a strap → `StrapSelector.handleProductClick` calls `setSelectedStrap` (`src/components/StrapSelector.tsx:119-122`)
3. User drops an image → `FaceUploader.onDrop` reads it as base64, opens the crop UI (`src/components/FaceUploader.tsx:71-94`)
4. User confirms crop → `getCroppedImg` produces a cropped base64 PNG, stored via `setUploadedFace` (`src/components/FaceUploader.tsx:102-122`, `src/utils/cropImage.ts`)
5. User clicks Combine → `CombineSection.handleCombine` POSTs `{ strapImage, faceImage, strapName, strapCategories, strapAttributes }` to `/api/generate` (`src/components/CombineSection.tsx:84-108`)
6. `/api/generate`: `classifyStrap` derives a `StrapProfile` from the submitted attributes (`src/lib/strapProfile.ts:77`), `sharp` builds 3 PNG reference images (draft composite, clean strap, clean face) (`src/app/api/generate/route.ts:98-166`), `replicate.run('black-forest-labs/flux-2-pro', ...)` is called with all 3 as `input_images` (`src/app/api/generate/route.ts:171-194`)
7. Result webp URL returned as `{ success: true, resultImage }`, rendered in `CombineSection` (`src/components/CombineSection.tsx:119-125`)

### Desktop ↔ Mobile Handoff Path

1. `FaceUploader` mounts, generates a `sessionId` via `crypto.randomUUID()`, builds `${origin}/mobile-upload?session=<id>` and renders it as a QR code (`src/components/FaceUploader.tsx:34-37`)
2. `FaceUploader` polls `GET /api/upload?sessionId=<id>` every 2.5s until an image is found (`src/components/FaceUploader.tsx:42-63`)
3. Phone scans the QR, lands on `/mobile-upload?session=<id>` (note: query param name is `session`, not `sessionId`) (`src/app/mobile-upload/page.tsx:13`)
4. Phone requests `getUserMedia`, live video renders inside a circular viewfinder guide (`src/app/mobile-upload/page.tsx:28-46`)
5. `capturePhoto` does a two-stage canvas crop: center-crop video to square, then crop the inner 72% (`CIRCLE_RATIO`) to match the visible ring (`src/app/mobile-upload/page.tsx:54-84`)
6. `handleUpload` POSTs `{ sessionId, image }` (base64 JPEG) to `/api/upload` — note the body key here IS `sessionId`, matching the API but not the earlier page's `session` query param (`src/app/mobile-upload/page.tsx:91-105`)
7. `/api/upload` POST upserts into MongoDB `sessions` collection (`src/app/api/upload/route.ts:30-49`)
8. Desktop's next poll (`GET /api/upload?sessionId=`) finds `session.image`, returns it, `FaceUploader` stops polling and enters the crop-review state (`src/app/api/upload/route.ts:5-27`, `src/components/FaceUploader.tsx:47-56`)

### Face Library Pick Path (bypasses crop step)

1. `FaceLibraryPicker` renders thumbnails via `<img src="/api/faces/image?key=...&thumb=1">`, server streams a resized JPEG from S3 through `getThumbnailBuffer` (`src/components/FaceLibraryPicker.tsx:85-91`, `src/app/api/faces/image/route.ts`, `src/lib/aws.ts:101-109`)
2. User clicks a thumbnail → `FaceUploader.handleSelectLibraryFace` sets `uploadedFace` to the marker string `s3://<key>` (not a data URI) and skips straight to the "ready" state, `isEditing = false` (`src/components/FaceUploader.tsx:125-131`)
3. On Combine, `/api/generate`'s `loadFaceBuffer` branches on the `s3://` prefix and calls `getObjectBuffer` (full-resolution, not the thumbnail) instead of decoding base64 (`src/app/api/generate/route.ts:15-22`)

### Catalog Sync Paths (manual, admin-triggered)

- `GET /api/woocommerce/sync`: paginates the WooCommerce REST API (`handdn.com`), formats each product, `deleteMany({})` then `insertMany` into MongoDB `products` (`src/app/api/woocommerce/sync/route.ts`)
- `GET /api/faces/sync`: lists all S3 objects under the configured prefix via `listAllFaceKeys`, `deleteMany({})` then `insertMany` into MongoDB `faces`, ensures a unique index on `key` (`src/app/api/faces/sync/route.ts`, `src/lib/aws.ts:57-78`)

**State Management:**
- Server state (products, faces) is fetched once per page load in the Server Component and passed down as props — no client-side refetching/caching layer (no React Query/SWR).
- Client-global state is the two-field Zustand store (`selectedStrap`, `uploadedFace`); everything else (crop coordinates, polling status, generation progress) is local `useState` inside the owning component.

## Key Abstractions

**`Product` type:**
- Purpose: represents a WooCommerce strap product as stored in MongoDB and consumed by the UI
- Examples: `src/lib/woocommerce.ts:8-18`, consumed in `src/components/StrapSelector.tsx`, `src/store/useAppStore.ts`
- Pattern: plain TypeScript type, no class/validation layer; MongoDB documents are cast to it with `as Product[]`

**`FaceItem` type:**
- Purpose: represents one S3-backed face photo's metadata (`key`/`name`/`category`), never the image bytes
- Examples: `src/lib/aws.ts:27`, consumed in `src/components/FaceLibraryPicker.tsx`, `src/components/FaceUploader.tsx`
- Pattern: plain TypeScript type; actual bytes are always fetched separately through `/api/faces/image`

**`StrapProfile`:**
- Purpose: normalizes a strap's real construction (padded/curved/stitch/tip/thickness) into a fixed set of enums so the FLUX prompt can be extended per-strap instead of one generic prompt for all
- Examples: `src/lib/strapProfile.ts:14-38` (type), `classifyStrap` (build), `buildStrapProfileClause` (render to prompt text)
- Pattern: pure functions, attribute-name lookup with regex/text fallback, no side effects

**Session document (MongoDB `sessions`):**
- Purpose: ephemeral one-field bridge (`sessionId` → `image`) for the desktop/mobile QR handoff
- Examples: `src/app/api/upload/route.ts:39-43`
- Pattern: upsert-by-key, no TTL/expiry configured — stale sessions accumulate indefinitely (see CONCERNS.md)

**"3 reference images" prompt input:**
- Purpose: gives FLUX-2-PRO one composition/placement hint image plus two "copy this exactly" clean references, instead of a single flattened composite
- Examples: `src/app/api/generate/route.ts:111-181` (`draftCompositeBuffer`, `strapReferenceBuffer`, `faceReferenceBuffer`)
- Pattern: all 3 built with `sharp`, encoded as PNG (not JPEG, to avoid chroma subsampling artifacts on strap texture), sent as `input_images` array in a fixed order the prompt text explicitly numbers

## Entry Points

**Desktop app root:**
- Location: `src/app/page.tsx`
- Triggers: any request to `/`
- Responsibilities: server-fetch product/face catalogs, render 3-column layout (`StrapSelector` / `FaceUploader` / `CombineSection`)

**Mobile upload page:**
- Location: `src/app/mobile-upload/page.tsx`
- Triggers: phone scanning the QR code shown by `FaceUploader`, i.e. `GET /mobile-upload?session=<id>`
- Responsibilities: camera capture, circular crop, POST to `/api/upload`

**Route Handlers:**
- Location: each `src/app/api/**/route.ts`
- Triggers: `fetch()` calls from client components, or direct browser navigation for the sync/admin endpoints
- Responsibilities: see Component Responsibilities table above

## Architectural Constraints

- **Threading:** Standard Next.js request-per-invocation model (Node.js runtime, single-threaded event loop per request); no worker threads or background job queue. `sharp` operations run synchronously within the request lifecycle of `/api/generate`.
- **Global state:** `src/lib/mongodb.ts` keeps a module-level `clientPromise` (cached on `global` in dev to survive hot-reload); `src/lib/aws.ts` constructs a module-level `S3Client` singleton at import time and throws immediately if required env vars are missing (fail-fast on cold start, not per-request).
- **Vercel timeout:** `export const maxDuration = 60` set in `src/app/api/generate/route.ts:1` and `src/app/api/faces/sync/route.ts:5` — Replicate generation and full S3 listing can both take longer than the default limit.
- **No background jobs:** catalog syncs (`/api/woocommerce/sync`, `/api/faces/sync`) are synchronous GET requests run manually, not cron/webhook-triggered — a sync that outlives `maxDuration` fails outright with no partial-progress recovery.
- **Query-param naming inconsistency:** the desktop→mobile link is `/mobile-upload?session=<id>` (mobile page reads `session`), but both the `/api/upload` POST body and GET query string use `sessionId` — a different key name for logically the same value. Any code touching this handoff must not assume the two are the same key.

## Anti-Patterns

### Orphaned module still under active maintenance comments

**What happens:** `src/lib/strapGeometry.ts` (395 lines, sharp-based two-piece strap detection/re-stacking) is not imported anywhere in `src/` — `grep -rn "strapGeometry" src/` only matches its own internal `console.log`/`console.warn` strings.
**Why it's wrong:** A substantial, actively-commented module (with tuning notes like "rough placeholder gap... tuned by eye") is dead code from the running app's perspective — it cannot affect `/api/generate` output, which may not match what the code comments imply is happening.
**Do this instead:** Either wire it into `/api/generate`'s strap-buffer preparation step (before the `strapResize`/`draftCompositeBuffer` logic in `src/app/api/generate/route.ts`) or remove it — don't leave a maintained-looking module disconnected from the pipeline it was clearly built for.

### Route handlers as the only server layer

**What happens:** Business logic (WooCommerce pagination/formatting, S3 sync, Replicate prompt construction, sharp image pipeline) is written directly inside `route.ts` `POST`/`GET` function bodies rather than in `src/lib/`, except where later extracted (`strapProfile.ts`). `src/app/api/woocommerce/sync/route.ts` and `src/app/api/generate/route.ts` are both 100–200+ lines of inline logic.
**Why it's wrong:** Makes the route handler impossible to unit test in isolation and couples HTTP concerns (status codes, `NextResponse.json`) with domain logic (prompt strings, image math).
**Do this instead:** Extract non-HTTP logic (e.g. the WooCommerce pagination loop, the sharp reference-image builder) into `src/lib/*.ts` functions, following the pattern already used for `classifyStrap`/`buildStrapProfileClause` in `src/lib/strapProfile.ts`.

## Error Handling

**Strategy:** Every route handler wraps its body in try/catch and returns `NextResponse.json({ success: false, error: ... }, { status: 500 })` (or a more specific 4xx for bad input) on failure; no shared error-handling middleware or typed error classes.

**Patterns:**
- Client components use `alert()` for user-facing errors (`src/components/CombineSection.tsx:114,124,128`, `src/components/FaceUploader.tsx:74,83,120`) — no toast/notification system.
- `/api/generate` retries once on a specific Replicate false-positive safety error (`E005`/"flagged as sensitive") before re-throwing (`src/app/api/generate/route.ts:186-194`).
- `src/lib/aws.ts` fails fast at module load time (throws during import) if any required AWS env var is missing, rather than failing per-request (`src/lib/aws.ts:9-13`).
- `getDatabaseProducts`/`getDatabaseFaces` swallow DB errors and return `[]` rather than throwing, so a Mongo outage renders an empty catalog instead of crashing the page (`src/lib/woocommerce.ts:41-44`, `src/lib/aws.ts:124-127`).

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.warn`/`console.error` throughout route handlers and `src/lib/*.ts`, mixed English and Vietnamese messages, with emoji prefixes (`📥`, `✅`, `❌`, `🚀`, `⏳`) used as a de facto log-level convention. No structured logging or external log aggregation.

**Validation:** Minimal — route handlers check for presence of required fields (e.g. `if (!strapImage || !faceImage)`) but do not validate types/shapes beyond that; no schema validation library (zod, etc.) is used anywhere.

**Authentication:** None. All API routes (including the destructive full-resync endpoints `/api/woocommerce/sync` and `/api/faces/sync`) are unauthenticated `GET`/`POST` handlers reachable by anyone who knows the URL. `WC_BAESE64_KEY`/AWS credentials are used only for the *outbound* calls to WooCommerce/S3, not to gate *inbound* access to these routes. `SYNC_SECRET_KEY` is referenced as a constant in `src/app/api/woocommerce/sync/route.ts` but never actually checked/enforced in the handler body.

---

*Architecture analysis: 2026-08-04*
</content>
