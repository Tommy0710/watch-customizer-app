# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint check
```

No test suite is currently configured.

## Architecture

Next.js App Router full-stack app. No separate backend — all server logic lives in `src/app/api/`.

**Core flow:**
1. Desktop: Server fetches strap products from MongoDB at render time (`getDatabaseProducts` in `src/lib/woocommerce.ts`) → passes to `StrapSelector`
2. Desktop: Face input has three paths — drag-drop upload (crops via `react-easy-crop`), QR/mobile handoff, or picking a preset from the AWS S3 face library (`FaceLibraryPicker`, no crop step)
3. Desktop: Shows QR code with a `sessionId`; mobile visits `/mobile-upload?session=<id>`
4. Mobile: `getUserMedia` live camera → canvas crop → POST base64 to `/api/upload` (stored in MongoDB `sessions`)
5. Desktop: Polls `GET /api/upload?sessionId=<id>` every 2.5s to retrieve the uploaded image
6. User clicks Combine → POST to `/api/generate` → Replicate FLUX-2-PRO returns a webp URL

**State:** Zustand store in `src/store/useAppStore.ts` holds only `selectedStrap` and `uploadedFace`. No prop drilling.

**Query param naming gotcha:** the desktop→mobile handoff link is `/mobile-upload?session=<id>` (mobile page reads it as `session`), but the `/api/upload` route itself expects the same value under a *different* key, `sessionId`, in both the POST body and the GET query string. Don't assume the two are named the same thing when tracing the flow.

## API Routes

| Route | Purpose |
|---|---|
| `POST /api/upload` | Saves `{ sessionId, image }` into MongoDB `sessions` collection (upsert) |
| `GET /api/upload?sessionId=` | Polls for the image; returns it once found |
| `POST /api/generate` | Resizes face via sharp, sends strap URL + resized face base64 to Replicate FLUX-2-PRO |
| `GET /api/woocommerce/sync` | Full re-sync of WooCommerce products from `handdn.com` into MongoDB `products` collection (delete-all then insert) |
| `GET /api/faces/sync` | Full re-sync of the AWS S3 face library into MongoDB `faces` collection (delete-all then insert) — run manually after adding new photos to the bucket |
| `GET /api/faces/image?key=` | Streams one S3 object's bytes through the server (validates `key` exists in `faces` first); the only route returning raw binary instead of JSON |

## Key Conventions

**Image pipeline in `/api/generate`:** Replicate's FLUX-2-PRO gets **3 reference images** (`input_images: [draft, strapReference, faceReference]`), not a single flattened composite — a single-image approach let the model redraw strap patterns and misplace the watch head, especially on detailed/artistic strap photos. All 3 are built server-side with sharp and encoded as **PNG** (not JPEG — JPEG chroma subsampling visibly degrades fine repeating strap patterns):
- `draft` — the strap (resized to fit within `STRAP_MAX_DIMENSION` = 1200px, `withoutEnlargement: true`) with the face composited on top via `gravity: 'center'`. Face width = `faceWidth / 3.0` (both constants are starting estimates tuned by eye, not derived — revisit if proportions look off on new strap/face pairs). This image only tells the model roughly where/how big to place the watch head; the prompt explicitly says so.
- `strapReference` — the same strap resize, alone (no face), as the "copy this texture exactly" source.
- `faceReference` — the face image, resized the same way, as the "copy this case/dial exactly" source.
- `strapImage` accepts either a public WooCommerce URL (`fetch`) or a base64 data URI; `faceImage` goes through `loadFaceBuffer` (below).

**Strap filtering (`StrapSelector.tsx`):** products are silently hidden unless their WooCommerce category is in the hardcoded `ALLOWED_CATEGORIES` list (`Classic Watch Straps`, `Vintage Watch Straps`), and only attributes named in `ALLOWED_ATTRIBUTES` (`Color`, `Size`, `Material`) are surfaced as filter dropdowns. Products/attributes outside these lists exist in MongoDB but never render — update these constants, not just the WooCommerce data, when adding new categories/attributes.

**Face library (`src/lib/aws.ts`, `FaceLibraryPicker.tsx`):** S3 keys under the `watch-face-handdn` bucket are expected as `<AWS_S3_FACES_PREFIX>/<category>/<file>` — the first folder segment after the prefix becomes the filter category (falls back to `'Others'` for files with no subfolder). Folders confirmed as not real brands (leftover/misfiled uploads) are also redirected to `'Others'` via the hand-maintained `OTHER_FOLDERS` set — currently just `'a'`, a 314-file stray folder that duplicates the separately-named `a-lange-sohne` folder; extend that set as more naming issues turn up. `deriveCategoryAndName` in `src/lib/aws.ts` is the single place this convention is encoded. Picking a library face sets the Zustand `uploadedFace` string to the marker `s3://<key>` instead of a base64 data URI — `/api/generate`'s `loadFaceBuffer` branches on that prefix (via `getObjectBuffer`) vs. the base64 fallback, so both photo sources get identical resize treatment. The client never talks to S3 directly or embeds AWS credentials — thumbnails and the final face buffer are both fetched server-side and streamed through `/api/faces/image?key=`.

**Mobile camera crop:** The viewfinder circle occupies `CIRCLE_RATIO = 0.72` (72%) of the square container. `capturePhoto` uses two-stage canvas crop: center-crop video → square, then crop the inner 72% to match exactly what's visible in the ring.

**MongoDB:** Singleton client in `src/lib/mongodb.ts` (global ref to avoid reconnection in dev hot-reload). Three collections: `products` (strap catalog), `sessions` (temporary cross-device handoff), `faces` (S3 face-library metadata: `key`/`name`/`category`, no image bytes).

**Vercel timeout:** `export const maxDuration = 60` at the top of `/api/generate/route.ts` — Replicate calls can take 30–50 s.

**Unused dependency:** `@supabase/supabase-js` is in `package.json` but nothing in `src/` imports it — don't assume a Supabase integration exists.

## Environment Variables (.env.local)

```
MONGODB_URI=
REPLICATE_API_TOKEN=
WC_CONSUMER_KEY=
WC_CONSUMER_SECRET=
WC_BAESE64_KEY=        # base64(key:secret) for WooCommerce Basic Auth — note the typo in the name
AWS_REGION=
AWS_S3_BUCKET=
AWS_S3_FACES_PREFIX=   # optional folder prefix within the bucket, e.g. "faces/"
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Watch Customizer — Production Hardening**

A Next.js App Router app where customers pick a leather watch strap, upload or pick a face photo, and get an AI-generated composite (FLUX-2-PRO via Replicate) showing the assembled watch. Currently a working demo/internal-test app, not yet live to real customers.

**Core Value:** Every "Combine" click must reliably produce an accurate, correctly-proportioned watch image — the AI generation pipeline (`src/app/api/generate/route.ts`, `src/lib/strapProfile.ts`) is the product's single most important, most fragile piece of logic.

### Constraints

- **Tech stack**: Next.js 16.2.3 / React 19.2.4 (bleeding-edge; per `AGENTS.md`, API behavior may differ from training data — verify against `node_modules/next/dist/docs/` before using unfamiliar APIs) — existing, not renegotiable this milestone.
- **No new external services**: rate-limiting must use MongoDB (already in the stack), not Upstash/Redis — explicit user decision to avoid adding a new paid dependency for a pre-launch app.
- **Test framework**: Vitest — user's explicit choice over Jest for Next.js 16/React 19 compatibility and setup simplicity.
- **UI is frozen**: no visual/layout changes this milestone, regardless of what refactoring touches nearby files.
- **AI pipeline behavior must not regress**: any refactor touching `src/app/api/generate/route.ts` or `src/lib/strapProfile.ts` must preserve exact current prompt/constant values unless a requirement explicitly calls for changing them (none do this milestone) — tests should lock in current behavior, not change it.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5 (strict mode) - entire `src/` tree, `.ts`/`.tsx`
- `tsconfig.json` target `ES2017`, module resolution `bundler`, path alias `@/*` → `./src/*`
- CSS via Tailwind CSS v4 - `src/app/globals.css`
- Code comments/log strings are written in Vietnamese throughout `src/lib/` and `src/app/api/**/route.ts` (e.g. `src/lib/woocommerce.ts`, `src/app/api/upload/route.ts`) — expected, not a mistake, when reading server logs.
## Runtime
- Node.js (local dev observed: v22.16.0); no `.nvmrc` or `engines` field in `package.json` pinning a version
- Deployed as a Next.js serverless/edge-capable app on Vercel (see Platform Requirements)
- npm (lockfile: `package-lock.json` present, 327KB)
## Frameworks
- Next.js 16.2.3 (App Router) - `src/app/`, uses Route Handlers (`route.ts`) for all backend logic, no separate server
- React 19.2.4 / React DOM 19.2.4 - UI layer
- Zustand 5.0.12 - global client state, `src/store/useAppStore.ts` (holds only `selectedStrap` and `uploadedFace`)
- None configured. No test runner, no `*.test.*`/`*.spec.*` files found, and `CLAUDE.md` explicitly states "No test suite is currently configured."
- Tailwind CSS v4 (`^4.2.2`) via `@tailwindcss/postcss` plugin - `postcss.config.mjs`
- `tailwind.config.js` exists but is an **empty file** (0 bytes) — all Tailwind v4 config is CSS-based (likely `@theme` in `globals.css`), not JS-based
- ESLint 9 (flat config) - `eslint.config.mjs`, extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Autoprefixer `^10.5.0` (devDependency, used via PostCSS pipeline alongside Tailwind)
## Key Dependencies
- `replicate` `^1.4.0` - calls `black-forest-labs/flux-2-pro` image generation model, used only in `src/app/api/generate/route.ts`
- `sharp` `^0.34.5` - all server-side image resize/composite/format-conversion work (`src/app/api/generate/route.ts`, `src/lib/aws.ts`)
- `mongodb` `^7.1.1` - official driver, singleton client in `src/lib/mongodb.ts`
- `@aws-sdk/client-s3` `^3.1087.0` - S3 face-library access, `src/lib/aws.ts`
- `@woocommerce/woocommerce-rest-api` `^1.0.2` - listed as a dependency but **not imported anywhere in `src/`**; the actual WooCommerce sync (`src/app/api/woocommerce/sync/route.ts`) uses raw `fetch` with manually built Basic Auth headers instead of this SDK
- `zustand` `^5.0.12` - client state store
- `qrcode.react` `^4.2.0` - renders the desktop→mobile handoff QR code
- `react-dropzone` `^15.0.0` - desktop drag-drop face upload
- `react-easy-crop` `^5.5.7` - desktop crop UI for uploaded face photos (not used on mobile, which does its own canvas crop)
- `axios` `^1.15.0` - present as a dependency; most server code uses native `fetch` instead (WooCommerce sync, strap image download in `/api/generate`) — check individual call sites before assuming which HTTP client is in use for a given file
- `@supabase/supabase-js` `^2.103.0` - in `package.json`, zero imports found anywhere in `src/`. No Supabase integration exists despite the dependency being installed.
- `@google/design.md` `^0.3.0` - unusual package name in `dependencies`; no imports found in `src/`. Verify whether this is an accidental/leftover dependency before relying on it.
## Configuration
- `.env.local` (gitignored, present locally) declares: `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `AI_API_KEY`, `MONGODB_URI`, `AUTH_TRUST_HOST`, `REPLICATE_API_TOKEN`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `AI_API_KEY` and `AUTH_TRUST_HOST` are declared in `.env.local` but **no references found anywhere in `src/`** — likely leftover from scaffolding or a removed feature (auth was never wired up despite `AUTH_TRUST_HOST` suggesting NextAuth/Auth.js intent)
- `WC_BAESE64_KEY` (used in `src/app/api/woocommerce/sync/route.ts` as `BASE64_KEY`, note the typo in the name) and `SYNC_SECRET_KEY` (also read in the same file) are referenced in code but **not present in the local `.env.local`** — `SYNC_SECRET_KEY` is read into a constant but never actually checked/enforced anywhere in the route, so it currently has no effect even if set
- `AWS_S3_FACES_PREFIX` (optional, referenced in `src/lib/aws.ts`) is also not in local `.env.local` — defaults to `''` (bucket root) when unset
- Never read `.env.local` contents directly when investigating secrets; only variable names are enumerated here
- `next.config.ts` - effectively empty (`NextConfig = {}`, no custom options set)
- `postcss.config.mjs` - registers `@tailwindcss/postcss` only
- `eslint.config.mjs` - flat config, ignores `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
## Platform Requirements
- Node.js + npm
- Requires `.env.local` populated with MongoDB URI, Replicate token, AWS S3 credentials, and WooCommerce credentials to run all features locally (S3/Replicate/WooCommerce features will throw at import/request time otherwise — `src/lib/aws.ts` fails fast at module load if any AWS var is missing)
- Vercel (per `CLAUDE.md` and the `maxDuration = 60` export convention used in `src/app/api/generate/route.ts` and `src/app/api/faces/sync/route.ts` — this export only has meaning on Vercel's serverless function runtime)
- Vercel does not read `.env.local`; all env vars listed above must be configured separately in the Vercel project settings
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- React components: PascalCase, `.tsx` — `src/components/CombineSection.tsx`, `src/components/StrapSelector.tsx`, `src/components/FaceLibraryPicker.tsx`, `src/components/FaceUploader.tsx`
- Library modules: camelCase, `.ts` — `src/lib/mongodb.ts`, `src/lib/woocommerce.ts`, `src/lib/aws.ts`, `src/lib/strapProfile.ts`, `src/lib/strapGeometry.ts`
- API routes: always `route.ts` inside a folder named for the endpoint segment (Next.js App Router convention) — `src/app/api/generate/route.ts`, `src/app/api/upload/route.ts`, `src/app/api/faces/image/route.ts`
- Store: single file, camelCase with `use` prefix — `src/store/useAppStore.ts`
- Utilities: camelCase — `src/utils/cropImage.ts`
- camelCase throughout — `getDatabaseProducts`, `classifyStrap`, `buildStrapProfileClause`, `deriveCategoryAndName`, `loadFaceBuffer`
- Handler functions inside components prefixed `handle` — `handleCombine` in `src/components/CombineSection.tsx`
- Boolean-returning/classifying helpers named descriptively, not `isX`/`hasX` universally — e.g. `classifyStrap`, `classifyThickness` in `src/lib/strapProfile.ts`
- camelCase for locals and state — `isGenerating`, `resultImage`, `elapsedSeconds` in `src/components/CombineSection.tsx`
- SCREAMING_SNAKE_CASE for module-level tunable constants — `STRAP_MAX_DIMENSION`, `FACE_TO_STRAP_WIDTH_RATIO`, `SHORT_END_TOP_RATIO`, `FACE_DETAIL_WIDTH_RATIO` in `src/app/api/generate/route.ts`; `THICKNESS_TIERS` in `src/lib/strapProfile.ts`; `VALID_BRANDS`, `IMAGE_EXT` in `src/lib/aws.ts`
- Booleans read naturally as flags without an `is`/`has` prefix in domain types — `padded`, `curvedEnd`, `foldedEdge`, `doublePadded` (see `StrapProfile` type in `src/lib/strapProfile.ts`)
- PascalCase for `type` and named exports — `Product`, `Category`, `Tag`, `Attribute` in `src/lib/woocommerce.ts`; `StrapProfile`, `Attribute` in `src/lib/strapProfile.ts`; `FaceItem` in `src/lib/aws.ts`
- `type` is used exclusively over `interface` for data shapes, except for Zustand store state which uses `interface` — `interface AppState` in `src/store/useAppStore.ts`
## Code Style
- No Prettier config present (`.prettierrc*` not found) — formatting is whatever ESLint/editor defaults produce, not enforced by a dedicated formatter
- Indentation is inconsistent across files: 4 spaces in `src/app/api/generate/route.ts` and `src/lib/strapProfile.ts`, 2 spaces in `src/lib/mongodb.ts`, `src/lib/aws.ts`, `src/lib/woocommerce.ts`, `src/app/api/upload/route.ts`, `src/store/useAppStore.ts` — match the surrounding file's existing indentation rather than imposing a single style
- Quote style is mixed: single quotes dominate in most `src/lib/*.ts` and `src/app/api/*/route.ts` files; double quotes appear frequently for user-facing strings and JSX (`"Please select a watch strap in Step 1!"` in `src/components/CombineSection.tsx`) — no hard rule enforced, but prefer single quotes for imports/keys and double quotes for literal English sentences shown to users, matching existing usage
- Semicolons are used consistently everywhere
- ESLint via flat config `eslint.config.mjs`, extending `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` — no custom rule overrides beyond ignoring `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- No `.eslintrc*` legacy file; only the flat `eslint.config.mjs`
- Run via `npm run lint` (`eslint` with no explicit target, relies on default flat config file discovery)
- No Prettier integration, no `lint-staged`, no pre-commit hook config found in the repo
## Import Organization
- `@/*` maps to `./src/*` (configured in `tsconfig.json` `compilerOptions.paths`) — always import internal modules via `@/lib/...`, `@/components/...`, `@/store/...`, `@/utils/...` rather than relative `../../` paths across directories
## Error Handling
- API routes wrap the entire handler body in try/catch and always return a `NextResponse.json` with a `success` boolean, never let an exception propagate uncaught — see `src/app/api/generate/route.ts`, `src/app/api/upload/route.ts`
- Server-side catch blocks log with `console.error` before responding; error responses to the client use user-safe generic messages (not raw error text) in `/api/generate` — `"Something went wrong while generating your preview. Please try again."` in `src/app/api/generate/route.ts` — while `/api/upload` leaks `error.message` directly to the client (`src/app/api/upload/route.ts:47`), which is an inconsistency to be aware of when adding new routes
- Client-side async handlers (`handleCombine` in `src/components/CombineSection.tsx`) use `try/catch/finally`, resetting loading state (`setIsGenerating(false)`) in `finally`, and surface failures via `alert(...)` rather than inline UI error state
- Fail-fast validation for required environment variables at module load time, not at request time — `src/lib/aws.ts:9-13` throws immediately if `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_S3_BUCKET` are missing; `src/lib/mongodb.ts:9-11` does the same for `MONGODB_URI`
- Non-fatal DB read errors are swallowed and return an empty array rather than throwing, so a broken catalog fetch degrades to "no products" instead of crashing the page — `getDatabaseProducts` in `src/lib/woocommerce.ts`, `getDatabaseFaces` in `src/lib/aws.ts`
- Retry-once pattern for a known-flaky external API error: `src/app/api/generate/route.ts:186-194` retries the Replicate call exactly once when the error message matches a known false-positive safety-filter code (`E005`), rethrows for any other error
## Logging
- Emoji-prefixed log messages mark pipeline stages for quick visual scanning in server logs — `📥` for incoming request, `🛠️` for a resize step, `🚀` before calling the external model, `✅` on success, `❌` on error, `⚠️` on a recoverable warning (all in `src/app/api/generate/route.ts`); `❌` also used for DB read failures in `src/lib/woocommerce.ts` and `src/lib/aws.ts`
- Request logging truncates large payloads instead of dumping them — base64 image strings are logged as `"${value.slice(0, 40)}...(base64)"` rather than in full (`src/app/api/generate/route.ts:34-40`), to avoid flooding logs while still being able to tell what kind of input was sent
- Some error/comment strings are in Vietnamese in older files — `src/lib/mongodb.ts:10` (`'Vui lòng thêm MONGODB_URI vào file .env.local'`), `src/lib/woocommerce.ts:42` (`"❌ Lỗi khi đọc Database:"`), `src/app/api/upload/route.ts` (Vietnamese comments throughout: `"Máy tính gọi vào đây để 'hỏi thăm' xem có ảnh chưa"`). Newer files (`src/app/api/generate/route.ts`, `src/lib/strapProfile.ts`, `src/lib/aws.ts`) are English-only. When editing an existing file, match its established language; new files should default to English.
## Comments
- `src/app/api/generate/route.ts` — e.g. the `STRAP_MAX_DIMENSION` comment block (lines 62-70) explains it was lowered from 1600 to 1200 then raised back after a reported quality regression; the `FACE_TO_STRAP_WIDTH_RATIO` comment (lines 82-93) documents a 0.23 → 0.20 → 0.10 → 0.07 → 0.20 → 0.16 tuning history and *why* each step happened; the `SHORT_END_TOP_RATIO` comment (lines 116-125) documents 0.42 → 0.33 → 0.28 tuning against real generation results
- `src/lib/strapProfile.ts` — the `habanaBuckleSidePadding` field doc comment (lines 22-31) explains a past mistake ("First attempt at this got the direction backwards...") and the specific reason material names are deliberately excluded from the prompt; the module header comment documns why WooCommerce attributes are preferred over name/category regex, with a concrete coverage percentage (~86%)
- Not used. No `/** ... */` doc-comment blocks found; all documentation is done via regular `//` line comments and inline block comments above the relevant code.
## Function Design
## Module Design
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- Single Server Component entry point (`page.tsx`) does the only server-side data fetch on initial load; everything downstream is client components communicating through one small Zustand store.
- No REST/GraphQL API layer between client and DB — API routes are thin, purpose-built endpoints (upload/poll, generate, sync, image proxy), not a generic CRUD API.
- Cross-device handoff (desktop ↔ mobile) is implemented via a polling MongoDB document (`sessions` collection) instead of WebSockets/SSE.
- Third-party catalogs (WooCommerce products, S3 face photos) are pulled into MongoDB via manual "full sync" endpoints (delete-all + reinsert) rather than queried live on each request — MongoDB is the read path for the UI, not a cache in front of live APIs.
- Image processing (resize/composite/encode) is done server-side with `sharp` inside the `/api/generate` route handler itself — no separate image-processing service or serverless function.
## Layers
- Purpose: initial data fetch + page shell
- Location: `src/app/page.tsx`, `src/app/layout.tsx`
- Contains: async Server Component, font/metadata setup
- Depends on: `src/lib/woocommerce.ts`, `src/lib/aws.ts`
- Used by: Next.js router
- Purpose: interactive UI — filtering, cropping, polling, triggering generation
- Location: `src/components/*.tsx`, `src/app/mobile-upload/page.tsx`
- Contains: `'use client'` React components, local `useState`/`useEffect` state
- Depends on: `useAppStore`, `/api/*` fetch calls, `src/utils/cropImage.ts`
- Used by: `src/app/page.tsx`, Next.js router (mobile-upload)
- Purpose: share `selectedStrap`/`uploadedFace` between sibling components without prop drilling
- Location: `src/store/useAppStore.ts`
- Contains: one Zustand `create()` store, no persistence/middleware
- Depends on: `src/lib/woocommerce.ts` (`Product` type only)
- Used by: `StrapSelector`, `FaceUploader`, `CombineSection`
- Purpose: all server-side mutation and third-party integration work
- Location: `src/app/api/**/route.ts`
- Contains: Next.js Route Handlers (`GET`/`POST` exports), no shared controller abstraction
- Depends on: `src/lib/mongodb.ts`, `src/lib/aws.ts`, `src/lib/strapProfile.ts`, `sharp`, `replicate` SDK
- Used by: client components via `fetch`, and directly via browser for sync endpoints
- Purpose: encapsulate MongoDB/S3/classification logic reused by route handlers and the page
- Location: `src/lib/mongodb.ts`, `src/lib/woocommerce.ts`, `src/lib/aws.ts`, `src/lib/strapProfile.ts`, `src/lib/strapGeometry.ts`
- Contains: typed helper functions (`getDatabaseProducts`, `getDatabaseFaces`, `getObjectBuffer`, `classifyStrap`), no classes
- Depends on: `mongodb`, `@aws-sdk/client-s3`, `sharp` npm packages
- Used by: `src/app/page.tsx`, API routes
- MongoDB Atlas (`watch_customizer` DB — collections `products`, `sessions`, `faces`)
- AWS S3 (`watch-face-handdn` bucket, face photo library)
- Replicate (`black-forest-labs/flux-2-pro` model)
- WooCommerce REST API on `handdn.com` (source of truth for strap products, pulled via `/api/woocommerce/sync`)
## Data Flow
### Primary "Combine" Path (desktop, drag-drop face)
### Desktop ↔ Mobile Handoff Path
### Face Library Pick Path (bypasses crop step)
### Catalog Sync Paths (manual, admin-triggered)
- `GET /api/woocommerce/sync`: paginates the WooCommerce REST API (`handdn.com`), formats each product, `deleteMany({})` then `insertMany` into MongoDB `products` (`src/app/api/woocommerce/sync/route.ts`)
- `GET /api/faces/sync`: lists all S3 objects under the configured prefix via `listAllFaceKeys`, `deleteMany({})` then `insertMany` into MongoDB `faces`, ensures a unique index on `key` (`src/app/api/faces/sync/route.ts`, `src/lib/aws.ts:57-78`)
- Server state (products, faces) is fetched once per page load in the Server Component and passed down as props — no client-side refetching/caching layer (no React Query/SWR).
- Client-global state is the two-field Zustand store (`selectedStrap`, `uploadedFace`); everything else (crop coordinates, polling status, generation progress) is local `useState` inside the owning component.
## Key Abstractions
- Purpose: represents a WooCommerce strap product as stored in MongoDB and consumed by the UI
- Examples: `src/lib/woocommerce.ts:8-18`, consumed in `src/components/StrapSelector.tsx`, `src/store/useAppStore.ts`
- Pattern: plain TypeScript type, no class/validation layer; MongoDB documents are cast to it with `as Product[]`
- Purpose: represents one S3-backed face photo's metadata (`key`/`name`/`category`), never the image bytes
- Examples: `src/lib/aws.ts:27`, consumed in `src/components/FaceLibraryPicker.tsx`, `src/components/FaceUploader.tsx`
- Pattern: plain TypeScript type; actual bytes are always fetched separately through `/api/faces/image`
- Purpose: normalizes a strap's real construction (padded/curved/stitch/tip/thickness) into a fixed set of enums so the FLUX prompt can be extended per-strap instead of one generic prompt for all
- Examples: `src/lib/strapProfile.ts:14-38` (type), `classifyStrap` (build), `buildStrapProfileClause` (render to prompt text)
- Pattern: pure functions, attribute-name lookup with regex/text fallback, no side effects
- Purpose: ephemeral one-field bridge (`sessionId` → `image`) for the desktop/mobile QR handoff
- Examples: `src/app/api/upload/route.ts:39-43`
- Pattern: upsert-by-key, no TTL/expiry configured — stale sessions accumulate indefinitely (see CONCERNS.md)
- Purpose: gives FLUX-2-PRO one composition/placement hint image plus two "copy this exactly" clean references, instead of a single flattened composite
- Examples: `src/app/api/generate/route.ts:111-181` (`draftCompositeBuffer`, `strapReferenceBuffer`, `faceReferenceBuffer`)
- Pattern: all 3 built with `sharp`, encoded as PNG (not JPEG, to avoid chroma subsampling artifacts on strap texture), sent as `input_images` array in a fixed order the prompt text explicitly numbers
## Entry Points
- Location: `src/app/page.tsx`
- Triggers: any request to `/`
- Responsibilities: server-fetch product/face catalogs, render 3-column layout (`StrapSelector` / `FaceUploader` / `CombineSection`)
- Location: `src/app/mobile-upload/page.tsx`
- Triggers: phone scanning the QR code shown by `FaceUploader`, i.e. `GET /mobile-upload?session=<id>`
- Responsibilities: camera capture, circular crop, POST to `/api/upload`
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
### Route handlers as the only server layer
## Error Handling
- Client components use `alert()` for user-facing errors (`src/components/CombineSection.tsx:114,124,128`, `src/components/FaceUploader.tsx:74,83,120`) — no toast/notification system.
- `/api/generate` retries once on a specific Replicate false-positive safety error (`E005`/"flagged as sensitive") before re-throwing (`src/app/api/generate/route.ts:186-194`).
- `src/lib/aws.ts` fails fast at module load time (throws during import) if any required AWS env var is missing, rather than failing per-request (`src/lib/aws.ts:9-13`).
- `getDatabaseProducts`/`getDatabaseFaces` swallow DB errors and return `[]` rather than throwing, so a Mongo outage renders an empty catalog instead of crashing the page (`src/lib/woocommerce.ts:41-44`, `src/lib/aws.ts:124-127`).
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
