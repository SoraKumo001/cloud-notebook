# packages/frontend/

## Responsibility
TanStack Router frontend: React 19 SPA (CSR only, no SSR), TanStack Router (file-based routing), Tailwind CSS styling, Vitest unit tests, Playwright e2e tests. Targets Cloudflare Workers + Static Assets for production deployment.

## Stack
- **Framework**: TanStack Router (file-based routes in `src/routes/`). Pure CSR (no SSR).
- **UI**: React 19, Tailwind CSS 4.
- **PDF**: pdfjs-dist (browser-only, dynamically imported).
- **Tokenization**: js-tiktoken cl100k_base.
- **Markdown**: react-markdown.
- **DnD**: @dnd-kit (core + sortable + utilities).
- **Bundler**: Vite with React + Tailwind plugins.
- **Testing**: Vitest (unit), Playwright (`e2e/`).

## Dev Workflow
- `pnpm --filter frontend dev` — Vite dev on `:5173`. Proxies `/api/*` to `http://127.0.0.1:8787` (wrangler dev) so the browser sees the same origin. Production uses the Access-issued JWT header sent from the frontend to the Worker domain.
- `pnpm --filter frontend build` — vite build. Output `dist/` is bundled into the Worker as static assets by `.github/workflows/deploy.yml`.
- `pnpm --filter frontend test` — Vitest unit tests.
- `pnpm --filter frontend e2e` — Playwright tests (browser required).

## Build Optimizations (vite.config.ts)
`manualChunks` separates vendors into:
- `react-vendor` — react + react-dom.
- `router-vendor` — @tanstack/react-router.
- `dnd-vendor` — @dnd-kit.

## Subdirectories
| Directory | Responsibility | Map |
|-----------|----------------|-----|
| src/ | All frontend TypeScript code | [src/codemap.md](src/codemap.md) |
| src/routes/ | TanStack Router file-based pages | (covered in [src/codemap.md](src/codemap.md)) |
| src/components/ | Reusable React components | (covered in [src/codemap.md](src/codemap.md)) |
| src/hooks/ | Custom hooks wrapping the backend REST API | [src/hooks/codemap.md](src/hooks/codemap.md) |
| src/lib/ | Browser-only utilities | [src/lib/codemap.md](src/lib/codemap.md) |
| src/contexts/ | React contexts (AuthContext) | (covered in [src/codemap.md](src/codemap.md)) |
| e2e/ | Playwright end-to-end tests | (test only) |