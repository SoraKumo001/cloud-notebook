# packages/frontend/src/

## Responsibility
React 19 UI: TanStack Router file-based routes, shared components, custom hooks wrapping the backend REST API, and browser-only utilities for PDF parsing, tokenization, and webpage fetching. The dev proxy (`vite.config.ts`) forwards `/api/*` to the wrangler dev backend on `:8787` so the browser sees the same origin.

## Architecture

### Routes (TanStack Router file-based)
- `routes/__root.tsx` — root layout.
- `routes/index.tsx` — landing page.
- `routes/login.tsx` — login flow (Cloudflare Access redirects to this page).
- `routes/notebooks/index.tsx` — notebook list, includes the Sign Out link pointing to `/api/auth/logout` (M23).
- `routes/notebooks/$notebookId.tsx` — notebook detail with sources/notes/chat tabs.

### Components (`src/components/`)
- `NotebookSettingsModal.tsx` — per-notebook AI provider config with API key masking (M24 fix: re-typing the mask no longer sends `••••••••` as the actual key).
- `SourceList.tsx` — DnD-reorderable list of sources (`@dnd-kit`).
- `ChatPanel.tsx` — SSE chat consumer (delegates to `useChatStream`).
- `NoteEditor.tsx` — note CRUD UI (delegates to `useNotes`).
- `McpTokenPanel.tsx` — MCP Bearer-token generation/revocation UI.

### Hooks (`src/hooks/`)
See [hooks/codemap.md](hooks/codemap.md) for the full API surface.

### Lib (`src/lib/`)
See [lib/codemap.md](lib/codemap.md) for browser-only utilities (PDF, tokenization, webpage fetch).

### Contexts (`src/contexts/`)
- `AuthContext` — provides the authenticated user object from Cloudflare Access JWT (passed via Workers `c.var.user`).

## Key Frontend Patterns

### Error envelope
```ts
const body = await res.json().catch(() => ({}))
throw new Error((body as { error?: string }).error || `<action> failed: ${res.status}`)
```
Matches the backend's `{ error: string }` envelope (M20). No typed parsing — `as { error?: string }` is the universal cast.

### Optimistic updates
`useSources`, `useNotes`, `useChatSessions` apply local state mutations before the server confirms. On failure, call `refresh()` to rollback (server state is source of truth).

### AbortController
`useIngestPipeline` and `useChatStream` use `AbortController` to cancel in-flight requests on unmount or `reset()`. The chat SSE handler ignores errors when `abortController.signal.aborted` is true.

### LocalStorage session ID
`useChatStream` persists the active session ID per notebook in `localStorage` under `cloud-notebook:session:<notebookId>`. Restored on mount.

### API key masking (M24)
`NotebookSettingsModal` stores the real key as the literal `'••••••••'` placeholder. The `handleApiKeyChange` callback now sets `apiKeyDirty = trimmed.length > 0 && value !== MASKED_KEY`, so re-typing the mask (or clearing to empty) is treated as "no change" instead of overwriting the real key with garbage.

### Dynamic imports
Heavy browser-only modules (`pdfjs-dist` worker, `js-tiktoken` chunker) are loaded via `await import(...)` inside hooks to keep the initial bundle small.

## Subdirectories
| Directory | Responsibility | Map |
|-----------|----------------|-----|
| routes/ | TanStack Router file-based pages | — |
| components/ | Reusable React components | — |
| hooks/ | Custom hooks (API + state) | [hooks/codemap.md](hooks/codemap.md) |
| lib/ | Browser-only utilities | [lib/codemap.md](lib/codemap.md) |
| contexts/ | React contexts (AuthContext) | — |
| e2e/ | Playwright e2e tests | (test only — excluded) |