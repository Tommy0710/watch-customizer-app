# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint check
```

## Architecture

Next.js App Router full-stack app. No separate backend — all server logic lives in `src/app/api/`.

**Core flow:**
1. Desktop: Server fetches strap products from MongoDB at render time → passes to `StrapSelector`
2. Desktop: Shows QR code with a `sessionId`; mobile visits `/mobile-upload?session=<id>`
3. Mobile: `getUserMedia` live camera → canvas crop → POST base64 to `/api/upload` (stored in MongoDB `sessions`)
4. Desktop: Polls `/api/upload?session=<id>` to retrieve the uploaded image
5. User clicks Combine → POST to `/api/generate` → Replicate FLUX-2-PRO returns a webp URL

**State:** Zustand store in `src/store/useAppStore.ts` holds only `selectedStrap` and `uploadedFace`. No prop drilling.

## API Routes

| Route | Purpose |
|---|---|
| `POST /api/upload` | Saves `{ sessionId, image }` into MongoDB `sessions` collection |
| `GET /api/upload?session=` | Polls for the image; returns it once found |
| `POST /api/generate` | Resizes face to ½ its original width via sharp, sends strap URL + resized face base64 to Replicate FLUX-2-PRO |
| `GET /api/woocommerce/sync` | Full re-sync of WooCommerce products into MongoDB `products` collection (delete-all then insert) |

## Key Conventions

**Image pipeline in `/api/generate`:**
- `strapImage` arrives as a public WooCommerce URL — passed directly to Replicate
- `faceImage` arrives as base64 — sharp reads its original dimensions, resizes to 50% width, re-encodes to JPEG data URI before sending

**Mobile camera crop:** The viewfinder circle occupies `CIRCLE_RATIO = 0.72` (72%) of the square container. `capturePhoto` uses two-stage canvas crop: center-crop video → square, then crop the inner 72% to match exactly what's visible in the ring.

**MongoDB:** Singleton client in `src/lib/mongodb.ts` (global ref to avoid reconnection in dev hot-reload). Two collections: `products` (strap catalog) and `sessions` (temporary cross-device handoff).

**Vercel timeout:** `export const maxDuration = 60` at the top of `/api/generate/route.ts` — Replicate calls can take 30–50 s.

## Environment Variables (.env.local)

```
MONGODB_URI=
REPLICATE_API_TOKEN=
WC_CONSUMER_KEY=
WC_CONSUMER_SECRET=
WC_BAESE64_KEY=        # base64(key:secret) for WooCommerce Basic Auth — note the typo in the name
```
