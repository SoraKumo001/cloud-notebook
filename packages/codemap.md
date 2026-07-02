# packages/

## Responsibility
pnpm monorepo workspaces. Two packages: `backend` (Cloudflare Workers) and `frontend` (TanStack Router CSR SPA). The root workspace scripts orchestrate both.

## Workspaces
| Workspace | Description | Map |
|-----------|-------------|-----|
| `backend/` | Cloudflare Workers Hono backend | [backend/codemap.md](backend/codemap.md) |
| `frontend/` | TanStack Router React 19 SPA (CSR) | [frontend/codemap.md](frontend/codemap.md) |

## Root Scripts (from `/package.json`)
- `pnpm dev` — `pnpm -r --parallel dev` — runs both packages' `dev` script.
- `pnpm build` — `pnpm -r build`.
- `pnpm test` — `pnpm -r test`.
- `pnpm lint` — `biome check .` (110 files).
- `pnpm lint:fix` — `biome check --write .`.

## Root `pnpm-workspace.yaml`
Declares both packages as workspaces and restricts `onlyBuiltDependencies` to `better-sqlite3` (native build needed for the test D1 adapter).

## Notes
- No cross-package code sharing beyond TypeScript types. The frontend imports its own types directly; the backend's types are not consumed by the frontend (the API contract is the JSON schema).