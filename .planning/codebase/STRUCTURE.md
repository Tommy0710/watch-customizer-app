# Codebase Structure

**Analysis Date:** 2026-08-04

## Directory Layout

```
watch-customizer-app/
├── src/
│   ├── app/                       # Next.js App Router: pages + API routes
│   │   ├── layout.tsx              # Root HTML layout, font setup
│   │   ├── page.tsx                 # Desktop app entry (Server Component)
│   │   ├── globals.css              # Tailwind v4 global styles
│   │   ├── mobile-upload/
│   │   │   └── page.tsx             # Phone camera capture page (client)
│   │   └── api/                     # All server logic — no separate backend
│   │       ├── generate/route.ts    # POST — builds sharp images, calls Replicate FLUX-2-PRO
│   │       ├── upload/route.ts      # POST/GET — desktop↔mobile handoff via MongoDB `sessions`
│   │       ├── faces/
│   │       │   ├── categories/route.ts  # GET — distinct face categories
│   │       │   ├── image/route.ts       # GET — streams/thumbnails one S3 object
│   │       │   └── sync/route.ts        # GET — full re-sync of S3 face library → MongoDB `faces`
│   │       └── woocommerce/
│   │           └── sync/route.ts        # GET — full re-sync of WooCommerce products → MongoDB `products`
│   ├── components/                # Client ('use client') React components
│   │   ├── StrapSelector.tsx        # Strap search/filter grid, writes selection to store
│   │   ├── FaceUploader.tsx         # Orchestrates drag-drop / QR-mobile / library face input
│   │   ├── FaceLibraryPicker.tsx    # Search/filter grid over the S3 face library
│   │   └── CombineSection.tsx       # Combine button + generation progress + result display
│   ├── lib/                        # Server-usable data-access & domain logic (no 'use client')
│   │   ├── mongodb.ts               # Singleton MongoClient (dev hot-reload safe)
│   │   ├── woocommerce.ts           # `Product` type + `getDatabaseProducts` (reads MongoDB)
│   │   ├── aws.ts                   # `FaceItem` type, S3 client, list/get/thumbnail helpers
│   │   ├── strapProfile.ts          # `classifyStrap` — derives construction facts for the FLUX prompt
│   │   └── strapGeometry.ts         # Two-piece strap detection/re-stack (currently unused — see CONCERNS.md)
│   ├── store/
│   │   └── useAppStore.ts           # Zustand store: { selectedStrap, uploadedFace }
│   └── utils/
│       └── cropImage.ts             # Canvas-based crop helper for react-easy-crop output
├── public/                         # Static assets served at /
├── node_modules/                   # Dependencies (not committed logic)
├── package.json                    # Scripts: dev, build, start, lint
├── tsconfig.json                   # `@/*` path alias → `src/*`
├── next.config.ts                  # Next.js config
├── AGENTS.md                       # Framework-version warning (read before writing Next.js code)
└── CLAUDE.md                       # Project-specific instructions for AI assistants
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js App Router root — every folder under it is either a page route or, under `api/`, a Route Handler
- Contains: `page.tsx`/`layout.tsx` files (pages), `route.ts` files (API endpoints)
- Key files: `src/app/page.tsx` (main UI), `src/app/api/generate/route.ts` (core AI generation logic)

**`src/app/api/`:**
- Purpose: the entire server/backend of this app — there is no separate backend service
- Contains: one subfolder per logical endpoint group (`generate`, `upload`, `faces`, `woocommerce`), each with a `route.ts` exporting `GET`/`POST`
- Key files: see Directory Layout above; all routes are flat (no nested dynamic segments)

**`src/components/`:**
- Purpose: all interactive (client-side) UI pieces used by `src/app/page.tsx`
- Contains: exactly 4 components, all `'use client'`, all rendered directly by `page.tsx` or by each other (`FaceUploader` renders `FaceLibraryPicker`)
- Key files: `StrapSelector.tsx`, `FaceUploader.tsx`, `FaceLibraryPicker.tsx`, `CombineSection.tsx`

**`src/lib/`:**
- Purpose: server-safe data access and domain logic shared between the Server Component (`page.tsx`) and API routes
- Contains: typed helper functions, no React/JSX, no `'use client'` — every file here can run in a Route Handler or Server Component
- Key files: `mongodb.ts` (DB connection), `woocommerce.ts` / `aws.ts` (catalog reads), `strapProfile.ts` (prompt-building domain logic)

**`src/store/`:**
- Purpose: single Zustand store shared across client components
- Contains: one file, `useAppStore.ts`
- Key files: `useAppStore.ts`

**`src/utils/`:**
- Purpose: small stateless helper functions used by client components
- Contains: currently just the crop-canvas helper
- Key files: `cropImage.ts`

## Key File Locations

**Entry Points:**
- `src/app/page.tsx`: desktop app root, server-fetches catalogs
- `src/app/mobile-upload/page.tsx`: phone camera capture route
- `src/app/layout.tsx`: root HTML shell/fonts

**Configuration:**
- `tsconfig.json`: TypeScript config, defines the `@/*` → `src/*` import alias used everywhere (`import ... from '@/lib/...'`)
- `next.config.ts`: Next.js build/runtime config
- `.env.local` (not committed): all secrets — see CLAUDE.md's "Environment Variables" section for the full list

**Core Logic:**
- `src/app/api/generate/route.ts`: the AI image-generation pipeline (sharp + Replicate)
- `src/lib/strapProfile.ts`: strap construction classification feeding the generation prompt
- `src/lib/aws.ts`: S3 face library access + category derivation convention
- `src/lib/woocommerce.ts`: MongoDB product read (source of truth is `handdn.com` WooCommerce, synced in)

**Testing:**
- No test directory or test files exist anywhere in `src/`. No test runner is configured in `package.json`. (See CONVENTIONS.md/TESTING.md for quality-focus analysis.)

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g. `StrapSelector.tsx`, `FaceUploader.tsx`), one component per file, default-exported
- Route handlers: always literally `route.ts` inside a folder named after the endpoint segment (Next.js App Router convention) — e.g. `src/app/api/faces/image/route.ts` serves `GET /api/faces/image`
- Library/utility modules: `camelCase.ts` (e.g. `mongodb.ts`, `strapProfile.ts`, `cropImage.ts`)
- Page files: always literally `page.tsx` inside a folder named after the route segment (e.g. `src/app/mobile-upload/page.tsx` serves `/mobile-upload`)

**Directories:**
- Route segments are lowercase, kebab-case if multi-word (e.g. `mobile-upload`)
- API endpoint groups mirror their concern one level deep (e.g. `api/faces/{categories,image,sync}` all relate to the face library)

**Types:**
- Exported alongside the module that owns the data (`Product`/`Category`/`Tag`/`Attribute` in `src/lib/woocommerce.ts`; `FaceItem` in `src/lib/aws.ts`; `StrapProfile` in `src/lib/strapProfile.ts`) — no separate `types/` directory

## Where to Add New Code

**New API endpoint:**
- Create `src/app/api/<segment>/route.ts` exporting `GET`/`POST` as needed
- If it needs a DB read/write, import `clientPromise` from `src/lib/mongodb.ts` directly (no repository abstraction exists — every route currently calls `client.db('watch_customizer').collection(...)` inline)
- If it's long-running (>10s), add `export const maxDuration = 60;` at the top, matching `src/app/api/generate/route.ts:1`

**New client UI feature:**
- Add a component to `src/components/`, `PascalCase.tsx`, `'use client'` at the top
- Render it from `src/app/page.tsx` (or from an existing component, following `FaceUploader` → `FaceLibraryPicker` nesting)
- If it needs to share state with other components, extend `src/store/useAppStore.ts` (currently just 2 fields) rather than introducing prop drilling or a second store

**New server-side domain logic (non-HTTP):**
- Add a `camelCase.ts` file to `src/lib/`, following the `strapProfile.ts` pattern: pure functions, typed inputs/outputs, no HTTP-specific code (no `NextResponse` inside `src/lib/`)
- Import it from the relevant route handler

**New third-party integration:**
- Follow the `src/lib/aws.ts` pattern: fail-fast env var checks at module load, one client instance per module, typed helper functions exported for both the Server Component (initial fetch) and API routes (on-demand fetch) to use

**Utilities:**
- Stateless helpers (no React, no DB/network calls) go in `src/utils/`

## Special Directories

**`src/app/api/`:**
- Purpose: the app's entire backend
- Generated: No
- Committed: Yes

**`.next/`:**
- Purpose: Next.js build output/cache
- Generated: Yes
- Committed: No (should be gitignored)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

**`.planning/`:**
- Purpose: GSD workflow planning artifacts (this document lives here)
- Generated: Partially (docs like this are written by tooling, plans are authored)
- Committed: Project-dependent

---

*Structure analysis: 2026-08-04*
</content>
