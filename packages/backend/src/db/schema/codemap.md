# packages/backend/src/db/schema/

## Responsibility
Per-table D1 schema definitions (13 tables: `aiConnections`, `chatMessages`, `chatSessions`, `globalSettings`, `invitations`, `notebooks`, `notes`, `sessions`, `sourceChunks`, `sourceImages`, `sources`, `userSettings`, `users`). Each module exports the `sqliteTable(...)` definition plus inferred `*$inferSelect` / `*$inferInsert` types.

## Tables

### notebooks (notebooks.ts)
- **Columns**: `id` (PK), `userId`, `title`, `description`, `aiProvider` (no schema-level default; code applies `'workers-ai'`), `aiApiKey` (nullable, AES-GCM ciphertext), `aiBaseUrl`, `aiEmbeddingModel` (no schema-level default; code applies `'@cf/baai/bge-m3'` via `db/settings.ts`), `modelChat` / `modelSummarization` (no schema-level default; code applies `'@cf/meta/llama-3.1-8b-instruct-fast'` via `db/settings.ts`), `modelOcr` (no schema-level default; code applies `'@cf/meta/llama-3.2-11b-vision-instruct'` via `db/settings.ts`), `systemPrompt`, `mcpToken` (nullable, SHA-256 digest of the bearer token — deterministic hash for SQL `eq()` lookup; plaintext returned to user only at generation time), `createdAt`, `updatedAt`.
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

### users (users.ts)
- **Columns**: `id` (PK), `email` (text, unique), `passwordHash` (text), `name` (text, nullable), `isAdmin` (integer, boolean mode, default `false`), `createdAt`, `updatedAt`.
- **Index**: `idx_users_email` — unique index on `email`.
- Exports `User`, `NewUser` types.

### sessions (sessions.ts)
- **Columns**: `id` (PK), `userId` (FK → users, cascade), `expiresAt` (text), `createdAt`.
- HTTP session storage. No explicit index beyond PK.

### aiConnections (aiConnections.ts)
- **Columns**: `id` (PK), `userId` (text), `name` (text), `provider` (text — `'workers-ai'` | `'openai'` | `'anthropic'` | `'google'` | `'custom'`), `apiKey` (text, nullable, AES-GCM ciphertext), `baseUrl` (text, nullable), `createdAt`, `updatedAt`.
- Named AI provider connections referenced by `connectionId:model` notation in per-task model strings.

### userSettings (userSettings.ts)
- **Columns**: `userId` (PK), `aiProvider` (text, nullable), `aiApiKey` (text, nullable, AES-GCM ciphertext), `aiBaseUrl` (text, nullable), `aiEmbeddingModel` (text, default `'@cf/baai/bge-m3'`), `modelChat` (text, default `'@cf/meta/llama-3.1-8b-instruct-fast'`), `modelSummarization` (text, default `'@cf/meta/llama-3.1-8b-instruct-fast'`), `modelOcr` (text, default `'@cf/meta/llama-3.2-11b-vision-instruct'`), `systemPrompt` (text, nullable), `createdAt`, `updatedAt`.
- Per-user AI defaults. Resolved by `db/settings.ts` with notebook-level overrides taking precedence.

### invitations (invitations.ts)
- **Columns**: `id` (PK), `token` (text, unique), `email` (text), `invitedBy` (FK → users, cascade), `expiresAt` (text), `usedAt` (text, nullable), `usedBy` (FK → users, set null, nullable), `createdAt`.
- One-time signup tokens created by admin via `POST /api/auth/invitations`; consumed by `/api/auth/register`.

### Re-exports
`index.ts` re-exports all 13 tables as `export * from './<table>'`.

### globalSettings (globalSettings.ts)
- **Columns**: `id` (PK, default `'default'`), `storageProvider` (`'r2-binding' | 's3-compatible'`, default `'r2-binding'`), `storageConfig` (JSON, nullable), `updatedBy`, `updatedAt`.
- **Constraint**: `CHECK (id = 'default')` — the singleton invariant is enforced at the DB level.
- Singleton row holding the deployment's storage backend choice. For `s3-compatible`, `storageConfig` is JSON with `bucket`, `region`, `endpoint`, `forcePathStyle`, and AES-256-GCM-encrypted `accessKeyId` / `secretAccessKey`. Read by `getObjectStorage(env, db)` in `src/storage/factory.ts`. Written by `PUT /api/admin/storage`.

## Patterns

### D1 vs better-sqlite3 tests
The same column types work for both. `test/d1-adapter.ts` wraps better-sqlite3 to mimic the D1 API (the `D1Database` interface is web-standard).

### Cascade strategy
All child tables use `onDelete: 'cascade'` so RQBv2 `db.query.notebooks.findFirst({ with: { sources: { with: { sourceChunks: true } }, sourceImages: true } }).then(...)` works as expected for DELETE cascade queries.