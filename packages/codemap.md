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
- `pnpm setup:dev` — initializes dev environment.
- `pnpm deploy:full` — full deployment pipeline.
- `pnpm setup:production` — production environment setup.
- `pnpm setup:secrets` — configures secrets for deployment.

## Root `pnpm-workspace.yaml`
Declares both packages as workspaces. Has an `allowBuilds` field listing `@parcel/watcher`, `esbuild`, `sharp`, `workerd`.

## Root `package.json` (`pnpm.pnpm.onlyBuiltDependencies`)
Restricts native builds to `better-sqlite3` (needed for the test D1 adapter).

## Notes
- No cross-package code sharing beyond TypeScript types. The frontend imports its own types directly; the backend's types are not consumed by the frontend (the API contract is the JSON schema).