# Coding Conventions

**Analysis Date:** 2026-08-04

## Naming Patterns

**Files:**
- React components: PascalCase, `.tsx` — `src/components/CombineSection.tsx`, `src/components/StrapSelector.tsx`, `src/components/FaceLibraryPicker.tsx`, `src/components/FaceUploader.tsx`
- Library modules: camelCase, `.ts` — `src/lib/mongodb.ts`, `src/lib/woocommerce.ts`, `src/lib/aws.ts`, `src/lib/strapProfile.ts`, `src/lib/strapGeometry.ts`
- API routes: always `route.ts` inside a folder named for the endpoint segment (Next.js App Router convention) — `src/app/api/generate/route.ts`, `src/app/api/upload/route.ts`, `src/app/api/faces/image/route.ts`
- Store: single file, camelCase with `use` prefix — `src/store/useAppStore.ts`
- Utilities: camelCase — `src/utils/cropImage.ts`

**Functions:**
- camelCase throughout — `getDatabaseProducts`, `classifyStrap`, `buildStrapProfileClause`, `deriveCategoryAndName`, `loadFaceBuffer`
- Handler functions inside components prefixed `handle` — `handleCombine` in `src/components/CombineSection.tsx`
- Boolean-returning/classifying helpers named descriptively, not `isX`/`hasX` universally — e.g. `classifyStrap`, `classifyThickness` in `src/lib/strapProfile.ts`

**Variables:**
- camelCase for locals and state — `isGenerating`, `resultImage`, `elapsedSeconds` in `src/components/CombineSection.tsx`
- SCREAMING_SNAKE_CASE for module-level tunable constants — `STRAP_MAX_DIMENSION`, `FACE_TO_STRAP_WIDTH_RATIO`, `SHORT_END_TOP_RATIO`, `FACE_DETAIL_WIDTH_RATIO` in `src/app/api/generate/route.ts`; `THICKNESS_TIERS` in `src/lib/strapProfile.ts`; `VALID_BRANDS`, `IMAGE_EXT` in `src/lib/aws.ts`
- Booleans read naturally as flags without an `is`/`has` prefix in domain types — `padded`, `curvedEnd`, `foldedEdge`, `doublePadded` (see `StrapProfile` type in `src/lib/strapProfile.ts`)

**Types:**
- PascalCase for `type` and named exports — `Product`, `Category`, `Tag`, `Attribute` in `src/lib/woocommerce.ts`; `StrapProfile`, `Attribute` in `src/lib/strapProfile.ts`; `FaceItem` in `src/lib/aws.ts`
- `type` is used exclusively over `interface` for data shapes, except for Zustand store state which uses `interface` — `interface AppState` in `src/store/useAppStore.ts`

## Code Style

**Formatting:**
- No Prettier config present (`.prettierrc*` not found) — formatting is whatever ESLint/editor defaults produce, not enforced by a dedicated formatter
- Indentation is inconsistent across files: 4 spaces in `src/app/api/generate/route.ts` and `src/lib/strapProfile.ts`, 2 spaces in `src/lib/mongodb.ts`, `src/lib/aws.ts`, `src/lib/woocommerce.ts`, `src/app/api/upload/route.ts`, `src/store/useAppStore.ts` — match the surrounding file's existing indentation rather than imposing a single style
- Quote style is mixed: single quotes dominate in most `src/lib/*.ts` and `src/app/api/*/route.ts` files; double quotes appear frequently for user-facing strings and JSX (`"Please select a watch strap in Step 1!"` in `src/components/CombineSection.tsx`) — no hard rule enforced, but prefer single quotes for imports/keys and double quotes for literal English sentences shown to users, matching existing usage
- Semicolons are used consistently everywhere

**Linting:**
- ESLint via flat config `eslint.config.mjs`, extending `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` — no custom rule overrides beyond ignoring `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- No `.eslintrc*` legacy file; only the flat `eslint.config.mjs`
- Run via `npm run lint` (`eslint` with no explicit target, relies on default flat config file discovery)
- No Prettier integration, no `lint-staged`, no pre-commit hook config found in the repo

## Import Organization

**Order:**
Observed order in files with multiple imports (e.g. `src/app/api/generate/route.ts`):
1. Next.js / framework imports (`next/server`)
2. Third-party package imports (`replicate`, `sharp`)
3. Internal `@/lib/*` and `@/store/*` imports last

No blank-line grouping or import-sorting plugin enforces this — it is a loose convention, not machine-checked.

**Path Aliases:**
- `@/*` maps to `./src/*` (configured in `tsconfig.json` `compilerOptions.paths`) — always import internal modules via `@/lib/...`, `@/components/...`, `@/store/...`, `@/utils/...` rather than relative `../../` paths across directories

## Error Handling

**Patterns:**
- API routes wrap the entire handler body in try/catch and always return a `NextResponse.json` with a `success` boolean, never let an exception propagate uncaught — see `src/app/api/generate/route.ts`, `src/app/api/upload/route.ts`
- Server-side catch blocks log with `console.error` before responding; error responses to the client use user-safe generic messages (not raw error text) in `/api/generate` — `"Something went wrong while generating your preview. Please try again."` in `src/app/api/generate/route.ts` — while `/api/upload` leaks `error.message` directly to the client (`src/app/api/upload/route.ts:47`), which is an inconsistency to be aware of when adding new routes
- Client-side async handlers (`handleCombine` in `src/components/CombineSection.tsx`) use `try/catch/finally`, resetting loading state (`setIsGenerating(false)`) in `finally`, and surface failures via `alert(...)` rather than inline UI error state
- Fail-fast validation for required environment variables at module load time, not at request time — `src/lib/aws.ts:9-13` throws immediately if `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_S3_BUCKET` are missing; `src/lib/mongodb.ts:9-11` does the same for `MONGODB_URI`
- Non-fatal DB read errors are swallowed and return an empty array rather than throwing, so a broken catalog fetch degrades to "no products" instead of crashing the page — `getDatabaseProducts` in `src/lib/woocommerce.ts`, `getDatabaseFaces` in `src/lib/aws.ts`
- Retry-once pattern for a known-flaky external API error: `src/app/api/generate/route.ts:186-194` retries the Replicate call exactly once when the error message matches a known false-positive safety-filter code (`E005`), rethrows for any other error

## Logging

**Framework:** `console.log` / `console.warn` / `console.error` only — no structured logging library (e.g. pino, winston) is used.

**Patterns:**
- Emoji-prefixed log messages mark pipeline stages for quick visual scanning in server logs — `📥` for incoming request, `🛠️` for a resize step, `🚀` before calling the external model, `✅` on success, `❌` on error, `⚠️` on a recoverable warning (all in `src/app/api/generate/route.ts`); `❌` also used for DB read failures in `src/lib/woocommerce.ts` and `src/lib/aws.ts`
- Request logging truncates large payloads instead of dumping them — base64 image strings are logged as `"${value.slice(0, 40)}...(base64)"` rather than in full (`src/app/api/generate/route.ts:34-40`), to avoid flooding logs while still being able to tell what kind of input was sent
- Some error/comment strings are in Vietnamese in older files — `src/lib/mongodb.ts:10` (`'Vui lòng thêm MONGODB_URI vào file .env.local'`), `src/lib/woocommerce.ts:42` (`"❌ Lỗi khi đọc Database:"`), `src/app/api/upload/route.ts` (Vietnamese comments throughout: `"Máy tính gọi vào đây để 'hỏi thăm' xem có ảnh chưa"`). Newer files (`src/app/api/generate/route.ts`, `src/lib/strapProfile.ts`, `src/lib/aws.ts`) are English-only. When editing an existing file, match its established language; new files should default to English.

## Comments

**When to Comment:**
This codebase has an unusually heavy commenting convention: inline comments frequently document *why* a constant has its current value, including the numeric history of values that were tried and rejected, and the specific real-world observation or user feedback that drove each change. This is most extensive in:
- `src/app/api/generate/route.ts` — e.g. the `STRAP_MAX_DIMENSION` comment block (lines 62-70) explains it was lowered from 1600 to 1200 then raised back after a reported quality regression; the `FACE_TO_STRAP_WIDTH_RATIO` comment (lines 82-93) documents a 0.23 → 0.20 → 0.10 → 0.07 → 0.20 → 0.16 tuning history and *why* each step happened; the `SHORT_END_TOP_RATIO` comment (lines 116-125) documents 0.42 → 0.33 → 0.28 tuning against real generation results
- `src/lib/strapProfile.ts` — the `habanaBuckleSidePadding` field doc comment (lines 22-31) explains a past mistake ("First attempt at this got the direction backwards...") and the specific reason material names are deliberately excluded from the prompt; the module header comment documns why WooCommerce attributes are preferred over name/category regex, with a concrete coverage percentage (~86%)

**Convention for new code:** when adding a tunable constant (thresholds, ratios, dimensions) or a business rule with a non-obvious rationale, document the *reasoning* and any rejected alternatives inline, not just what the value is — this is the dominant, deliberate style of this codebase and should be continued, especially for anything touching the FLUX prompt/image pipeline or strap classification logic. Do not strip these comments during refactors; they encode tuning history that would otherwise be lost.

**JSDoc/TSDoc:**
- Not used. No `/** ... */` doc-comment blocks found; all documentation is done via regular `//` line comments and inline block comments above the relevant code.

## Function Design

**Size:** No hard size limit observed. Route handlers (e.g. `POST` in `src/app/api/generate/route.ts`) run 100+ lines as a single linear sequence of numbered steps (`// 1.`, `// 2.`, etc.) rather than being split into smaller functions — this numbered-step-in-one-function style is the norm for the `/api/generate` pipeline specifically. Smaller single-purpose helper functions (`classifyThickness`, `findAttribute`, `deriveCategoryAndName`) are extracted for logic reused or independently testable.

**Parameters:** Plain positional parameters for helper functions (`classifyStrap(name, categoryNames, attributes)`); destructured object parameters for API route bodies from `request.json()` (`const { strapImage, faceImage, strapName = '', strapCategories = [], strapAttributes = [] } = await request.json();` in `src/app/api/generate/route.ts:26`), with default values inline at the destructuring site rather than separate null checks.

**Return Values:** Async functions that read external resources (DB, S3) return typed Promises and catch-and-default to an empty array/object on failure rather than throwing, so callers (server components) don't need their own try/catch — see `getDatabaseProducts`, `getDatabaseFaces`.

## Module Design

**Exports:** Named exports for types and utility functions (`export type Product`, `export const getDatabaseProducts`), default export reserved for React components (`export default function CombineSection()`) and the Mongo client promise (`export default clientPromise` in `src/lib/mongodb.ts`).

**Barrel Files:** Not used. No `index.ts` re-export files found anywhere in `src/`; every import references the concrete module file directly via the `@/` alias.

---

*Convention analysis: 2026-08-04*
