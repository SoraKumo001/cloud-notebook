# AGENTS.md

OpenCode auto-loads this file into agent context on every session.

## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Available Codemaps

- `codemap.md` — repository atlas (root)
- `packages/codemap.md` — packages workspace
- `packages/backend/codemap.md` — backend package
- `packages/backend/src/codemap.md` — backend src/
- `packages/backend/src/db/codemap.md` — drizzle setup
- `packages/backend/src/db/schema/codemap.md` — D1 tables (13)
- `packages/backend/src/middleware/codemap.md` — Hono middleware
- `packages/frontend/codemap.md` — frontend package
- `packages/frontend/src/codemap.md` — frontend src/
- `packages/frontend/src/hooks/codemap.md` — API-wrapping hooks
- `packages/frontend/src/lib/codemap.md` — browser-only utilities

## Project Conventions

- **Backend**: Hono + Cloudflare Workers + D1 + R2 + Vectorize + Workers AI. All routes zod-validated via `vHook`. Authorization checks `notebooks.user_id === c.get('user').id` before every write.
- **Frontend**: TanStack Router (CSR, no SSR) + React 19 + Tailwind. Bundled into the Worker via `wrangler deploy`. Dynamic imports for heavy deps (`pdfjs-dist`, `mammoth`). `js-tiktoken` is statically imported in `lib/tokenizer.ts`, but the `lib/tokenizer` module itself is dynamically imported by callers. Error envelope `{ error: string }` matched by `(body as { error?: string }).error`.
- **Testing**: vitest (backend 266 tests, frontend 163 tests). Use `createTestEnv()` for backend tests (D1 in-memory adapter).
- **Tooling**: Biome for lint/format (NOT ESLint). pnpm workspaces. Default branch is `master`.

## Common Tasks

- **Add a new API route**: See `packages/backend/src/codemap.md` "Route Patterns" section for the zod + ownership check template.
- **Add a new AI provider**: See `packages/backend/src/codemap.md` "AI Providers" section. Note that embedding is currently locked to `workers-ai` (1024-dim Vectorize index).
- **Add a new file source type**: See `packages/frontend/src/lib/codemap.md` — add a parser module, then route it in `sourceParser.ts:parseFile`.
- **Add a new MCP tool**: See `packages/backend/src/codemap.md` "Business Logic > mcp-tools.ts" — use Zod shapes for argument validation.