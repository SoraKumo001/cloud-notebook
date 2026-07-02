# Repository Atlas: cloud-notebook

## Project Responsibility
Google NotebookLM-style RAG chat app, optimised for the Cloudflare serverless stack. Workers AI + D1 + R2 + Vectorize. PDF upload, RAG streaming chat with citation/hallucination guard, MCP server for external AI agents.

## Stack
- Frontend: TanStack Router (CSR) + React 19 + Tailwind + Vite
- PDF parsing: pdfjs-dist (browser)
- Tokenization: js-tiktoken cl100k_base
- Backend: Cloudflare Workers + Hono + drizzle-orm 1.0.0-rc.4
- DB: Cloudflare D1 (SQLite)
- Storage: pluggable — Cloudflare R2 (binding) or any S3-compatible service (AWS S3, MinIO, B2, R2-over-S3), selected at runtime via the admin `global_settings` table
- Vector DB: Cloudflare Vectorize (1024-dim, bge-large-en-v1.5)
- LLM / Embedding: Workers AI (default), with OpenAI / Anthropic / Google adapters
- Auth: Email + password with HMAC-signed session cookies (was: Cloudflare Access JWT)
- Tests: Vitest + better-sqlite3 (D1 in-memory) + Playwright

## System Entry Points
- `packages/backend/src/index.ts` — Hono app entry; mounts `/api/*` (authMiddleware + dbMiddleware + storageMiddleware + all routes), `/api/admin/*` (requireAdmin-guarded routes including `GET/PUT /api/admin/storage`), `/mcp` (own Bearer auth), and `local-uploads` (dev-only storage proxy).
- `packages/backend/src/storage/` — `ObjectStorage` interface + `R2BindingAdapter` (uses `env.BUCKET`) + `S3CompatibleAdapter` (uses `aws4fetch`). Selected per request by `factory.ts` reading the `global_settings` row.
- `packages/frontend/src/routes/__root.tsx` — TanStack Router root.
- `wrangler.jsonc` (`packages/backend/`) — Cloudflare Workers bindings: DB, BUCKET (optional), VECTORIZE, AI.
- `package.json` (root) — pnpm workspace orchestrator: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`.
- `.github/workflows/ci.yml` — `master` push: lint + format + backend/frontend tests + build.
- `.github/workflows/deploy.yml` — `master` push: D1 migration + Workers deploy + secrets (single job, frontend bundled as static assets). Secrets are reduced to `SESSION_SECRET`, `API_KEY_ENCRYPTION_MASTER`. R2 / S3 credentials are configured at runtime via the admin UI.
- `.github/workflows/pr.yml` — pull_request: backend/frontend tests + build.

## Directory Map (Aggregated)
| Directory | Responsibility | Detailed Map |
|-----------|----------------|--------------|
| `packages/backend/` | Cloudflare Workers Hono backend, bindings config, migrations, deployment docs | [View Map](packages/backend/codemap.md) |
| `packages/backend/src/` | All backend TypeScript: routes, middleware, AI providers, MCP | [View Map](packages/backend/src/codemap.md) |
| `packages/backend/src/db/` | drizzle client factory + RQBv2 relations graph | [View Map](packages/backend/src/db/codemap.md) |
| `packages/backend/src/db/schema/` | Per-table D1 schema definitions (9 tables — adds `global_settings`) | [View Map](packages/backend/src/db/schema/codemap.md) |
| `packages/backend/src/middleware/` | Hono middleware (DB injection, storage resolution) | [View Map](packages/backend/src/middleware/codemap.md) |
| `packages/backend/src/storage/` | Swappable `ObjectStorage` interface + R2/S3 adapters + factory | — |
| `packages/backend/drizzle/` | drizzle-kit v3 subfolder migration format | — |
| `packages/backend/drizzle/migrations/` | Flat migration files consumed by `wrangler d1 migrations apply` | — |
| `packages/backend/scripts/` | Build-time scripts (`sync-d1-migrations.mjs`) | — |
| `packages/backend/docs/` | Deployment walkthroughs | — |
| `packages/frontend/` | TanStack Router frontend, Vite config, e2e tests | [View Map](packages/frontend/codemap.md) |
| `packages/frontend/src/` | React routes, components, hooks, lib (PDF/tokenizer/webpage) | [View Map](packages/frontend/src/codemap.md) |
| `packages/frontend/src/hooks/` | Custom hooks wrapping the backend REST API | [View Map](packages/frontend/src/hooks/codemap.md) |
| `packages/frontend/src/lib/` | Browser-only utilities (PDF parsing, tokenization, webpage fetch) | [View Map](packages/frontend/src/lib/codemap.md) |
| `docs/` | Architecture / database / access-setup design docs | — |

## Cross-Cutting Patterns

### Error envelope
Backend returns `{ "error": "string" }` for all 4xx/5xx. Frontend reads via `(body as { error?: string }).error || <fallback>`. The shared validation hook (`vHook` in `index.ts`) returns `{ "error": "Validation failed: <first zod issue>" }` with status 400.

### Authorization (M18)
Every POST/PATCH/DELETE route that touches a notebook/source/notes/chat checks `notebooks.user_id === c.get('user').id` before any write. The deprecated `/api/sources/upload` returns 410 Gone.

### Vectorize dim guard (M21)
The Vectorize index is fixed at 1024-dim (bge-large-en-v1.5). PATCH /api/notebooks/:id rejects any `ai_provider` other than `workers-ai` with a clear 400. The `getEmbeddingProvider` factory throws on OpenAI/Google/Anthropic with actionable error messages.

### MCP transport (M22)
Stateless Streamable HTTP transport (`WebStandardStreamableHTTPServerTransport`, `enableJsonResponse: true`). One `McpServer` + transport per request. Tools use Zod shapes for argument validation.

### Swappable object storage (M24+)
The R2 binding was a hard dependency. It is now an implementation detail. All storage operations go through the `ObjectStorage` interface (`packages/backend/src/storage/interface.ts`). Two adapters:
  - `R2BindingAdapter` — uses `env.BUCKET` (native Cloudflare R2 binding). Zero credentials, lowest latency, zero egress within Cloudflare.
  - `S3CompatibleAdapter` — uses `aws4fetch` for SigV4 signing and HTTP I/O. Works with AWS S3, MinIO, Backblaze B2, and Cloudflare R2 via its S3 endpoint.

The active adapter is chosen per request by `getObjectStorage(env, db)` reading the singleton `global_settings` row. The `storageProvider` column is a discriminator (`r2-binding` | `s3-compatible`); the `storageConfig` column is a JSON blob holding the bucket, region, endpoint, and AES-256-GCM-encrypted access/secret keys for the S3-compatible path.

CORS routing: the R2 native binding generates presigned URLs to `*.r2.dev` (which works in the browser). The S3 adapter's presign() targets the user's endpoint directly — except for `r2.cloudflarestorage.com`, where CORS preflight fails on signed PUTs (see `packages/frontend/src/hooks/codemap.md:16`). For that one endpoint, the `/api/uploads/presign` route falls back to a Worker proxy URL.

Admin UI: `StorageSettingsModal` (admin-only). Storage credentials are never returned by the API — the GET endpoint only surfaces `has_access_key` / `has_secret_key` booleans. The PUT endpoint validates credentials with a real put+delete probe before saving.