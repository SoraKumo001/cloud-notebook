# packages/frontend/src/

## Responsibility
React 19 UI: TanStack Router file-based routes, shared components, custom hooks wrapping the backend REST API, and browser-only utilities for PDF parsing, tokenization, and webpage fetching. The dev proxy (`vite.config.ts`) forwards `/api/*` to the wrangler dev backend on `:8787` so the browser sees the same origin.

## Architecture

### Routes (TanStack Router file-based)
- `routes/__root.tsx` — root layout.
- `routes/index.tsx` — landing page.
- `routes/login.tsx` — local email/password login + registration form (POSTs to `/api/auth/login` or `/api/auth/register`).
- `routes/notebooks/index.tsx` — notebook list, includes the Sign Out link pointing to `/api/auth/logout` (M23).
- `routes/notebooks/$notebookId.tsx` — notebook detail with 3-column layout: left `SourceList`, middle `ChatPanel` (or `SourceEditor` when editing), right `NoteList`+`NoteEditor` with collapse toggle (`isNotesCollapsed`). No tab system.

### Components (`src/components/`)
**Single-file components:**
- `ChatPanel.tsx` — SSE chat consumer (delegates to `useChatStream`).
- `CitationChip.tsx` — citation display chip.
- `CreateNotebookModal.tsx` — new notebook creation modal.
- `InviteUserPanel.tsx` — invite user UI.
- `markdownComponents.tsx` — custom React components for react-markdown rendering.
- `McpTokenPanel.tsx` — MCP Bearer-token generation/revocation UI.
- `NoteEditor.tsx` — note CRUD UI (delegates to `useNotes`).
- `NoteList.tsx` — note list display.
- `NotebookCard.tsx` — notebook card in the list view.
- `NotFound.tsx` — 404 page.
- `SessionList.tsx` — chat session list.
- `SourceEditor.tsx` — source content editor.
- `StorageSettingsModal.tsx` — storage settings modal.
- `WebpageImporter.tsx` — webpage URL import UI.

**Subdirectory components:**
- `NotebookSettingsModal/` — per-notebook AI model selection (chat/summarization/OCR/embedding model pickers). Directory: `index.tsx`, `types.ts`, `AiSection.tsx`, `BasicSection.tsx`, `hooks/useNotebookSettings.ts`. No API key entry (keys are managed at the connection level via `routes/connections`).
- `GlobalSettingsModal/` — global settings (connections, settings sections). Directory: `index.tsx`, `types.ts`, `ConnectionsSection.tsx`, `SettingsSection.tsx`, `hooks/useGlobalSettings.ts`.
- `SourceList/` — DnD-reorderable list of sources (`@dnd-kit`). Directory: `index.tsx`, `SourceItem.tsx`, `types.ts`, `hooks/useSourceReorder.ts`.
- `ui/` — shared UI primitives: `Button.tsx`, `SearchableSelect.tsx`, `index.ts`.

### Hooks (`src/hooks/`)
See [hooks/codemap.md](hooks/codemap.md) for the full API surface.

### Lib (`src/lib/`)
See [lib/codemap.md](lib/codemap.md) for browser-only utilities (PDF, tokenization, webpage fetch).

### Contexts (`src/contexts/`)
- `AuthContext` — fetches the authenticated user via `GET /api/me` (HMAC-signed session cookie sent automatically). Exposes `{ user, loading, error, refresh }`. Used by `routes/__root.tsx` to gate the app shell.

## Key Frontend Patterns

### Error envelope
```ts
const body = await res.json().catch(() => ({}))
throw new Error((body as { error?: string }).error || `<action> failed: ${res.status}`)
```
Matches the backend's `{ error: string }` envelope (M20). Mostly `as { error?: string }` cast; 4 hooks (`useSources`, `useNotes`, `useChatSessions`, `useMcpToken`) migrated to a typed `ApiError` pattern that also reads `code` and throws `{ code, fallbackMessage, status } satisfies ApiError`.

### Optimistic updates
`useSources`, `useNotes`, `useChatSessions` apply local state mutations before the server confirms. On failure, call `refresh()` to rollback (server state is source of truth).

### AbortController
`useChatStream` uses `AbortController` to cancel in-flight SSE requests on unmount or `reset()`. The chat SSE handler ignores errors when `abortController.signal.aborted` is true. `useIngestPipeline` does NOT use `AbortController`.

### LocalStorage session ID
`useChatStream` persists the active session ID per notebook in `localStorage` under `cloud-notebook:session:<notebookId>`. Restored on mount.

### Dynamic imports
Heavy browser-only modules (`pdfjs-dist` worker, `mammoth`) are loaded via `await import(...)` inside parser hooks. `js-tiktoken` is statically imported in `lib/tokenizer.ts:1`, but the `lib/tokenizer` module itself is dynamically imported by callers (e.g. `useIngestPipeline.ts:252`), deferring the heavy encoding init.

## Subdirectories
| Directory | Responsibility | Map |
|-----------|----------------|-----|
| routes/ | TanStack Router file-based pages | — |
| components/ | Reusable React components | — |
| hooks/ | Custom hooks (API + state) | [hooks/codemap.md](hooks/codemap.md) |
| lib/ | Browser-only utilities | [lib/codemap.md](lib/codemap.md) |
| contexts/ | React contexts (AuthContext) | — |
| i18n/ | i18next provider, locale hook, formatters, en/ja locale JSON, `LanguageSwitcher` component, tests. Wrapped at `__root.tsx:14`. | — |

## Root files
- `test-setup.ts` — Vitest setup (referenced by `vitest.config.ts`).
- `styles.css` — global Tailwind styles (imported by `routes/__root.tsx:2`).