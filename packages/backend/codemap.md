# packages/backend/

## Responsibility
Cloudflare Workers backend package: Hono HTTP API, AI provider abstraction, MCP Streamable HTTP server, pluggable object storage (R2 binding or any S3-compatible service), AES-GCM encryption for per-notebook API keys AND S3-compatible storage credentials, D1 schema/migrations, vitest configuration.

## Stack
- Runtime: Cloudflare Workers (workerd), `compatibility_date: 2024-06-20`, `nodejs_compat` flag, `observability: { enabled: true }` (M23).
- Framework: Hono (web-standards routing).
- ORM: drizzle-orm 1.0.0-rc.4 with D1 (better-sqlite3 for tests).
- AI: Workers AI (bge-large-en-v1.5 embeddings + Llama 3.1 chat), OpenAI / Anthropic / Google adapters (`providers.ts`).
- Storage: D1 (relational), pluggable object storage (see `src/storage/`), Vectorize (1024-dim cosine).
- Auth: Email + password with HMAC-signed session cookies (see `auth.ts`).

## Bindings (wrangler.jsonc)
- `DB` — D1 database `cloud-notebook-db` (database_id is a deploy-time placeholder, substituted by `deploy.yml` jq step).
- `BUCKET` — *Optional*. R2 bucket `cloud-notebook-bucket`. Only required when the `global_settings` row selects `r2-binding` as the storage provider.
- `VECTORIZE` — Vectorize index `cloud-notebook-vector-bge` (1024-dim cosine).
- `AI` — Workers AI binding.
- Secrets: `SESSION_SECRET`, `API_KEY_ENCRYPTION_MASTER`. R2 / S3 credentials are NOT secrets — they are stored encrypted in the `global_settings` D1 table and managed via the admin UI.

## Scripts (root package.json workspaces)
- `pnpm --filter backend dev` — wrangler dev on `:8787`.
- `pnpm --filter backend build` — `tsc --noEmit`.
- `pnpm --filter backend test` — vitest (uses vitest-pool-workers on Linux CI; disabled on Windows per `vitest.config.ts`).
- `pnpm --filter backend db:generate` — drizzle-kit generate (writes to `drizzle/<timestamp>_<name>/`).
- `pnpm --filter backend db:migrate:local` / `:remote` — apply migrations from `drizzle/migrations/`.
- `pnpm --filter backend vectorize:create` — `wrangler vectorize create cloud-notebook-vector-bge --dimensions 1024 --metric cosine`.
- `pnpm --filter backend exec wrangler deploy` — deploy Worker with static assets.

## Subdirectories
| Directory | Responsibility | Map |
|-----------|----------------|-----|
| src/ | All backend TypeScript code | [src/codemap.md](src/codemap.md) |
| drizzle/ | drizzle-kit v3 subfolder migrations (generated) | — |
| drizzle/migrations/ | Flat mirror consumed by `wrangler d1 migrations apply` | — |
| scripts/ | Build-time scripts (`sync-d1-migrations.mjs` bridges drizzle-kit v3 subfolder format → wrangler-compatible flat layout) | — |
| docs/ | Deployment guides | — |