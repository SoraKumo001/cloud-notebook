# packages/frontend/

## Responsibility
TanStack Router frontend: React 19 SPA (CSR only, no SSR), TanStack Router (file-based routing), Tailwind CSS styling, Vitest unit tests, Playwright e2e tests. Targets Cloudflare Workers + Static Assets for production deployment.

## Stack
- **Framework**: TanStack Router (file-based routes in `src/routes/`). Pure CSR (no SSR).
- **UI**: React 19, Tailwind CSS 4 + daisyUI 5 (component classes like `btn`, `card`, `modal`, `alert` used throughout).
- **PDF**: pdfjs-dist (browser-only, dynamically imported).
- **Tokenization**: js-tiktoken cl100k_base.
- **Markdown**: react-markdown, remark-gfm, rehype-highlight, rehype-raw.
- **DnD**: @dnd-kit (core + sortable + utilities).
- **Icons**: lucide-react.
- **i18n**: i18next, i18next-browser-languagedetector, react-i18next.
- **Bundler**: Vite with React + Tailwind plugins.
- **Testing**: Vitest (unit), Playwright (`e2e/`).
- **Dev deps**: mammoth (docx import), daisyUI 5, @tanstack/router-cli, rollup-plugin-visualizer.

## Dev Workflow
- `pnpm --filter frontend dev` — Vite dev on `:5173`. Proxies `/api/*` to `http://127.0.0.1:8787` (wrangler dev) so the browser sees the same origin. Production uses the HMAC-signed session cookie (set by `/api/auth/login`) sent from the frontend to the Worker domain.
- `pnpm --filter frontend build` — vite build. Output `dist/` is bundled into the Worker as static assets by `wrangler deploy` (production deploy via `pnpm deploy:full`).
- `pnpm --filter frontend test` — Vitest unit tests.
- `pnpm --filter frontend start` — Vite preview (serves production build).
- `pnpm --filter frontend e2e` — Playwright tests (browser required).
- `pnpm --filter frontend e2e:ui` — Playwright tests with interactive UI mode.

## Build Optimizations (vite.config.ts)
`manualChunks` separates vendors into:
- `react-vendor` — react + react-dom.
- `router-vendor` — @tanstack/react-router.
- `icon-vendor` — lucide-react.
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