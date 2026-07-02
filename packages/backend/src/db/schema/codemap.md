# packages/backend/src/db/schema/

## Responsibility
Per-table D1 schema definitions (9 tables). Each module exports the `sqliteTable(...)` definition plus inferred `*$inferSelect` / `*$inferInsert` types.

## Tables

### notebooks (notebooks.ts)
- **Columns**: `id` (PK), `userId`, `title`, `description`, `aiProvider` (default `'workers-ai'`), `aiApiKey` (nullable, AES-GCM ciphertext), `aiBaseUrl`, `aiEmbeddingModel` (default `'@cf/baai/bge-large-en-v1.5'`), `modelChat` / `modelSummarization` (default `'@cf/meta/llama-3.1-8b-instruct-fast'`), `mcpToken` (nullable), `createdAt`, `updatedAt`.
- **Index**: `idx_notebooks_mcp_token` — partial unique index `where sql\`mcp_token IS NOT NULL\`` (NULLs treated as distinct on D1/SQLite, so multiple NULLs allowed).
- Exports `Notebook`, `NewNotebook` types.

### sources (sources.ts)
- **Columns**: `id` (PK), `notebookId` (FK → notebooks, cascade), `userId`, `name`, `type`, `r2Key`, `hash`, `status` (e.g. `'processing'` / `'completed'` / `'failed'`), `displayOrder` (integer, default 0), `createdAt`.
- **Indexes**: `idx_sources_notebook_display_order`, `idx_sources_notebook_status`, `idx_sources_notebook_hash` (dedup query in `POST /api/uploads/presign`).

### sourceChunks (sourceChunks.ts)
- **Columns**: `id` (PK), `sourceId` (FK → sources, cascade), `notebookId` (FK → notebooks, cascade), `content`, `pageNumber` (nullable).
- **Indexes**: `idx_source_chunks_source`, `idx_source_chunks_notebook`.

### sourceImages (sourceImages.ts)
- **Columns**: `id` (PK), `sourceId` (FK → sources, cascade), `notebookId` (FK → notebooks, cascade), `r2Key`, `pageNumber`, `createdAt`.
- **Indexes**: `idx_source_images_source`, `idx_source_images_notebook`.

### notes (notes.ts)
- **Columns**: `id` (PK), `notebookId` (FK → notebooks, cascade), `title`, `content`, `createdAt`, `updatedAt`.
- **Index**: `idx_notes_notebook_created`.

### chatSessions (chatSessions.ts)
- **Columns**: `id` (PK), `notebookId` (FK → notebooks, cascade), `title`, `createdAt`.
- **Index**: `idx_chat_sessions_notebook_created`.

### chatMessages (chatMessages.ts)
- **Columns**: `id` (PK), `sessionId` (FK → chatSessions, cascade), `role` (`'user'`/`'assistant'`/`'system'`), `content`, `createdAt`.
- **Index**: `idx_chat_messages_session_created`.

### Re-exports
`index.ts` re-exports all of the above as `export * from './<table>'`.

### globalSettings (globalSettings.ts)
- **Columns**: `id` (PK, default `'default'`), `storageProvider` (`'r2-binding' | 's3-compatible'`, default `'r2-binding'`), `storageConfig` (JSON, nullable), `updatedBy`, `updatedAt`.
- **Constraint**: `CHECK (id = 'default')` — the singleton invariant is enforced at the DB level.
- Singleton row holding the deployment's storage backend choice. For `s3-compatible`, `storageConfig` is JSON with `bucket`, `region`, `endpoint`, `forcePathStyle`, and AES-256-GCM-encrypted `accessKeyId` / `secretAccessKey`. Read by `getObjectStorage(env, db)` in `src/storage/factory.ts`. Written by `PUT /api/admin/storage`.

## Patterns

### D1 vs better-sqlite3 tests
The same column types work for both. `test/d1-adapter.ts` wraps better-sqlite3 to mimic the D1 API (the `D1Database` interface is web-standard).

### Cascade strategy
All child tables use `onDelete: 'cascade'` so RQBv2 `db.query.notebooks.findFirst({ with: { sources: { with: { sourceChunks: true } }, sourceImages: true } }).then(...)` works as expected for DELETE cascade queries.