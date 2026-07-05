# packages/frontend/src/hooks/

## Responsibility
Custom React hooks that wrap the backend REST API. Each hook encapsulates API calls, loading state, error state, and lifecycle (abort/reset) for a single backend resource.

## Hooks

### useIngestPipeline
- **Signature**: `useIngestPipeline(notebookId, userId): { uploadFiles, uploadWebpage, progress, isProcessing, reset, clearAllErrors }`.
- **State**: queue of files with per-file progress `{ status, percent, error }`. Statuses: `'pending' | 'parsing' | 'uploading' | 'finalizing' | 'done' | 'error'`.
- **Pipeline per file** (`processFile` in `useIngestPipeline.ts`):
  1. `detectSourceType(file)` — `.pdf` / `.txt` / `.md` / `.docx` by extension or MIME.
  2. `parseFile(file, sourceType)` (dynamically imported from `lib/sourceParser`).
  3. `calculateHash(file)` — SHA-256 via `crypto.subtle.digest`.
  4. `chunkText(parsed.fullText)` (dynamically imported from `lib/tokenizer`) — js-tiktoken cl100k_base.
  5. `POST /api/uploads/direct?key=...&contentType=...` — uploads file bytes directly through the Worker proxy. The backend `/api/uploads/presign` endpoint exists (`routes/sources/presign.ts:17`) but is no longer called by this pipeline.
  6. The browser PUTs the file to the returned URL.
  7. For each page image (PDF only): same direct upload, **concurrency 4** via local `asyncPool`.
  8. `POST /api/sources/finalize` with `{ notebookId, sourceId, fileName, type, hash, chunks, images }`.
- **Errors**: throws caught per file and surfaced via `updateFile(fileName, { status: 'error', error })`. Pipeline never throws to caller.

### useChatStream
- **Signature**: `useChatStream(notebookId, userId): { messages, isStreaming, error, activeSessionId, sendQuery, reset, loadSession }`.
- **State**: `messages[]` (id/role/content/citations/risk/reasons/chunks), `isStreaming`, `error`, `activeSessionId`.
- **Persistence**: `activeSessionId` is mirrored to `localStorage` under `cloud-notebook:session:<notebookId>`, restored on mount via `loadSession(storedId)`.
- **SSE events consumed**:
  - `meta` → sets `activeSessionId`, attaches retrieved chunks.
  - `delta` → appends `text` to assistant message.
  - `done` → sets `finalText`/`citations`/`risk`.
  - `error` → throws.
- **AbortController**: each `sendQuery` creates a controller; `reset()` aborts. Aborted errors are swallowed silently.
- **Optimistic messages**: both user message and an empty assistant placeholder are added before `fetch`; placeholder is removed on error.

### useSources
- **Signature**: `useSources(notebookId): { sources, loading, error, refresh, deleteSource, renameSource, createSource, reorderSources, getSourceContent, updateSourceContent, updateNotebook, deleteNotebook }`.
- **State**: `sources[]: Source` (with `status` mapped from API string `ready`/`processing`/`error`/`pending`).
- **Calls**: `GET /api/notebooks/:id/sources`, `DELETE/PATCH /api/sources/:id`, `POST /api/notebooks/:id/sources/reorder`, `PATCH /api/notebooks/:id`, `DELETE /api/notebooks/:id`, `POST /api/notebooks/:id/sources` (create), `GET/PUT /api/sources/:id/content` (content read/update).
- **Optimistic**: `deleteSource` filters local list first, then `refresh()` rolls back on error.

### useNotes
- **Signature**: `useNotes(notebookId): { notes, loading, error, refresh, createNote, updateNote, deleteNote }`.
- **Calls**: `GET/POST /api/notebooks/:id/notes`, `GET/PATCH/DELETE /api/notes/:noteId`.
- No optimistic updates — server state is re-fetched after every mutation.

### useChatSessions
- **Signature**: `useChatSessions(notebookId): { sessions, loading, error, refresh, deleteSession, renameSession }`.
- **Calls**: `GET /api/notebooks/:id/sessions`, `DELETE /api/sessions/:sessionId`, `PATCH /api/sessions/:sessionId`.

### useMcpToken
- **Signature**: `useMcpToken(notebookId): { hasToken, lastGeneratedToken, loading, error, generateToken, revokeToken, clearLastGeneratedToken }` — plaintext token is exposed only via `lastGeneratedToken` immediately after generation and cleared on demand via `clearLastGeneratedToken()`.
- **Calls**: `POST/DELETE /api/notebooks/:id/mcp-token`.
- **State**: stores the issued token in memory only (never persisted to localStorage).

### useNotebookStats
- **Signature**: `useNotebookStats(notebookId, sourcesVersion?): { stats, loading, error, refresh }`.
- **Calls**: `GET /api/notebooks/:id/stats`.
- **Consumed by**: `SourceList/index.tsx:29`.

## Common Patterns

### Error envelope
Every hook reads `await res.json().catch(() => ({}))` then casts `(body as { error?: string }).error || <fallback>`. Matches the backend's `{ error: string }` shape.

### AbortController
`useChatStream` (per-query) cancels requests on unmount or `reset()` via `AbortController`. `useIngestPipeline` does NOT use `AbortController`.

### No global cache
Each hook re-fetches on mount. The useChatStream session ID is the only state persisted to `localStorage`.

### Status mapping
`useSources.mapSourceStatus(apiStatus)` translates backend's `'completed'` → UI's `'ready'`, etc.