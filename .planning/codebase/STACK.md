# Technology Stack

**Analysis Date:** 2026-08-04

## Languages

**Primary:**
- TypeScript 5 (strict mode) - entire `src/` tree, `.ts`/`.tsx`
- `tsconfig.json` target `ES2017`, module resolution `bundler`, path alias `@/*` → `./src/*`

**Secondary:**
- CSS via Tailwind CSS v4 - `src/app/globals.css`
- Code comments/log strings are written in Vietnamese throughout `src/lib/` and `src/app/api/**/route.ts` (e.g. `src/lib/woocommerce.ts`, `src/app/api/upload/route.ts`) — expected, not a mistake, when reading server logs.

## Runtime

**Environment:**
- Node.js (local dev observed: v22.16.0); no `.nvmrc` or `engines` field in `package.json` pinning a version
- Deployed as a Next.js serverless/edge-capable app on Vercel (see Platform Requirements)

**Package Manager:**
- npm (lockfile: `package-lock.json` present, 327KB)

## Frameworks

**Core:**
- Next.js 16.2.3 (App Router) - `src/app/`, uses Route Handlers (`route.ts`) for all backend logic, no separate server
- React 19.2.4 / React DOM 19.2.4 - UI layer
- Zustand 5.0.12 - global client state, `src/store/useAppStore.ts` (holds only `selectedStrap` and `uploadedFace`)

**Testing:**
- None configured. No test runner, no `*.test.*`/`*.spec.*` files found, and `CLAUDE.md` explicitly states "No test suite is currently configured."

**Build/Dev:**
- Tailwind CSS v4 (`^4.2.2`) via `@tailwindcss/postcss` plugin - `postcss.config.mjs`
- `tailwind.config.js` exists but is an **empty file** (0 bytes) — all Tailwind v4 config is CSS-based (likely `@theme` in `globals.css`), not JS-based
- ESLint 9 (flat config) - `eslint.config.mjs`, extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Autoprefixer `^10.5.0` (devDependency, used via PostCSS pipeline alongside Tailwind)

## Key Dependencies

**Critical:**
- `replicate` `^1.4.0` - calls `black-forest-labs/flux-2-pro` image generation model, used only in `src/app/api/generate/route.ts`
- `sharp` `^0.34.5` - all server-side image resize/composite/format-conversion work (`src/app/api/generate/route.ts`, `src/lib/aws.ts`)
- `mongodb` `^7.1.1` - official driver, singleton client in `src/lib/mongodb.ts`
- `@aws-sdk/client-s3` `^3.1087.0` - S3 face-library access, `src/lib/aws.ts`
- `@woocommerce/woocommerce-rest-api` `^1.0.2` - listed as a dependency but **not imported anywhere in `src/`**; the actual WooCommerce sync (`src/app/api/woocommerce/sync/route.ts`) uses raw `fetch` with manually built Basic Auth headers instead of this SDK
- `zustand` `^5.0.12` - client state store

**Infrastructure:**
- `qrcode.react` `^4.2.0` - renders the desktop→mobile handoff QR code
- `react-dropzone` `^15.0.0` - desktop drag-drop face upload
- `react-easy-crop` `^5.5.7` - desktop crop UI for uploaded face photos (not used on mobile, which does its own canvas crop)
- `axios` `^1.15.0` - present as a dependency; most server code uses native `fetch` instead (WooCommerce sync, strap image download in `/api/generate`) — check individual call sites before assuming which HTTP client is in use for a given file

**Unused/dead dependency:**
- `@supabase/supabase-js` `^2.103.0` - in `package.json`, zero imports found anywhere in `src/`. No Supabase integration exists despite the dependency being installed.
- `@google/design.md` `^0.3.0` - unusual package name in `dependencies`; no imports found in `src/`. Verify whether this is an accidental/leftover dependency before relying on it.

## Configuration

**Environment:**
- `.env.local` (gitignored, present locally) declares: `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `AI_API_KEY`, `MONGODB_URI`, `AUTH_TRUST_HOST`, `REPLICATE_API_TOKEN`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `AI_API_KEY` and `AUTH_TRUST_HOST` are declared in `.env.local` but **no references found anywhere in `src/`** — likely leftover from scaffolding or a removed feature (auth was never wired up despite `AUTH_TRUST_HOST` suggesting NextAuth/Auth.js intent)
- `WC_BAESE64_KEY` (used in `src/app/api/woocommerce/sync/route.ts` as `BASE64_KEY`, note the typo in the name) and `SYNC_SECRET_KEY` (also read in the same file) are referenced in code but **not present in the local `.env.local`** — `SYNC_SECRET_KEY` is read into a constant but never actually checked/enforced anywhere in the route, so it currently has no effect even if set
- `AWS_S3_FACES_PREFIX` (optional, referenced in `src/lib/aws.ts`) is also not in local `.env.local` — defaults to `''` (bucket root) when unset
- Never read `.env.local` contents directly when investigating secrets; only variable names are enumerated here

**Build:**
- `next.config.ts` - effectively empty (`NextConfig = {}`, no custom options set)
- `postcss.config.mjs` - registers `@tailwindcss/postcss` only
- `eslint.config.mjs` - flat config, ignores `.next/**`, `out/**`, `build/**`, `next-env.d.ts`

## Platform Requirements

**Development:**
- Node.js + npm
- Requires `.env.local` populated with MongoDB URI, Replicate token, AWS S3 credentials, and WooCommerce credentials to run all features locally (S3/Replicate/WooCommerce features will throw at import/request time otherwise — `src/lib/aws.ts` fails fast at module load if any AWS var is missing)

**Production:**
- Vercel (per `CLAUDE.md` and the `maxDuration = 60` export convention used in `src/app/api/generate/route.ts` and `src/app/api/faces/sync/route.ts` — this export only has meaning on Vercel's serverless function runtime)
- Vercel does not read `.env.local`; all env vars listed above must be configured separately in the Vercel project settings

---

*Stack analysis: 2026-08-04*
