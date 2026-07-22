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
