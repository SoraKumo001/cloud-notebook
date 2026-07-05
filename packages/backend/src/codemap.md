# packages/backend/src/

## Responsibility
All backend TypeScript source code. The Hono app (`index.ts`) wires every route; supporting modules implement auth, AI provider abstraction, R2 presign, MCP transport, and the streaming RAG pipeline.

## Entry Point
`index.ts` mounts (in order):
1. _(CORS removed — same-origin via Workers Static Assets)_
2. **Security headers** (`app.use('*', async ...)` — runs after handler) — sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
3. **Auth middleware** for `/api/*` — `authMiddleware` (HMAC-signed session cookie).
4. **DB middleware** for `/api/*` — `dbMiddleware()` sets `c.get('db')` to a drizzle instance.
5. **Storage middleware** for `/api/*` — `storageMiddleware()` resolves the active `ObjectStorage` adapter (R2 binding or S3-compatible) from the `global_settings` row and exposes it as `c.get('storage')`.
6. **MCP server** mounted at `/mcp` — own Bearer-token auth (`mcpAuthMiddleware`).
7. **All HTTP routes** (zod-validated via shared `vHook`).
8. **`app.onError`** — in dev returns `{ error, code, details: { stack } }`; in prod returns `{ error: 'Internal Server Error', code }`.

## Module Map

### Routes & Entry
- `index.ts` — every route (notebooks, sources, notes, sessions, mcp-token, chat SSE, `/api/auth/logout` — returns 204 No Content, clears session cookie via `Set-Cookie`).
- `mcp.ts` — MCP Streamable HTTP transport (`WebStandardStreamableHTTPServerTransport`, `enableJsonResponse: true`, stateless). One `McpServer` + transport per request. Delegates JSON-RPC dispatch to the SDK.
- `routes/auth.ts` — auth routes: register, login, logout (204 cookie-clear), me, invitations (requireAdmin).
- `routes/chat.ts` — SSE RAG chat stream.
- `routes/notes.ts` — notes CRUD.
- `routes/connections.ts` — AI connections CRUD.
- `routes/settings.ts` — user/global settings + admin storage routes (`GET/PUT /admin/storage` with requireAdmin).
- `routes/debug.ts` — debug/probe endpoints.
- `routes/common.ts` — shared route helpers.
- `routes/notebooks/{index,crud,settings,vector}.ts` — notebook routes.
- `routes/sources/{index,crud,ingest,presign}.ts` — source routes.

### Middleware
- `auth.ts` — `authMiddleware`, `getAuthContext`, `requireAdmin`. Email + password with HMAC-signed session cookies.
- `middleware/db.ts` — `dbMiddleware()` creates a drizzle instance from the D1 binding and exposes it via `c.get('db')`.
- `middleware/storage.ts` — `storageMiddleware()` reads the `global_settings` row, decrypts any S3-compatible secrets, and attaches the active `ObjectStorage` adapter via `c.get('storage')`. Tests inject a mock via `env.__storage` to bypass the factory.

### Business Logic
- `chat.ts` — `streamChat()` SSE RAG pipeline: builds `getEmbeddingProvider(env, {...})` per call → `embedQuery(provider, query)` → Vectorize top-K (`VECTORIZE_TOP_K = 8`) with `filter: { notebook_id: { $eq } }` → notebook metadata cache (5 min TTL via `caches.default`, `chat.ts:133-229`) → JOIN chunks+sources in D1 (M15.2) → LLM stream → write SSE events `meta` / `delta` / `done` / `error`. Auto-reindex path when Vectorize returns 0 matches. `db.batch()` for chatSessions + chatMessages insert (M17 atomicity).
- `mcp-tools.ts` — `registerTools(server, env, notebook)` registers 6 tools (list_sources, get_source, search_sources, list_chat_sessions, get_chat_history, chat) with **Zod shapes** for argument validation. Embeddings via `getEmbeddingProvider(env, ...)` then `embedQuery(embedProvider, query)` (`mcp-tools.ts:133-140`), RAG chat via `chatViaRag` (parses SSE into JSON).
- `mcp-auth.ts` — `mcpAuthMiddleware`: Bearer token lookup against `notebooks.mcp_token` (partial unique index). Sets `c.get('notebook')`.

### AI Providers
- `providers/` — directory of AI provider classes + factories:
  - `providers/index.ts` — factories: `getChatProvider`, `getEmbedProvider`, `getScriptProvider`, `getOcrProvider` (4th factory, undocumented).
  - `providers/workers-ai.ts` — `WorkersAIChatProvider`, `WorkersAIEmbedProvider`, `WorkersAIScriptProvider`, `WorkersAiOcrProvider`.
  - `providers/openai.ts` — `OpenAIChatProvider`, `OpenAIScriptProvider`, `OpenAIOcrProvider`.
  - `providers/anthropic.ts` — `AnthropicChatProvider`, `AnthropicScriptProvider`, `AnthropicOcrProvider`.
  - `providers/google.ts` — `GoogleChatProvider`, `GoogleScriptProvider`, `GoogleOcrProvider`.
  - `providers/base.ts` — shared types, default model `@cf/baai/bge-m3` (line 49).
  - Note: `getEmbedProvider` in `providers/index.ts:45-67` throws on OpenAI/Google/Anthropic for embeddings (1024-dim guard), while `getEmbeddingProvider` in `embeddings.ts` is a separate function that supports openai/google.
- `embeddings.ts` — `getEmbeddingProvider(env, config)` — supports `workers-ai`, `openai`, `custom`, and `google`; only `anthropic` and unknown values throw. Default model `@cf/baai/bge-m3` (1024-dim). Also exports `embedChunks(provider, chunks, opts)` (Promise pool concurrency, batch size 32, exponential backoff on 429/5xx) and `embedQuery(provider, query)`. Note: the 1024-dim guard that throws on OpenAI/Google/Anthropic for embeddings lives in `providers/index.ts:getEmbedProvider`, a separate function for the chat/script path.

### Object Storage (M24+)
- `storage/interface.ts` — `ObjectStorage` interface: `presign(key, ct, expSec)`, `put(key, body, ct)`, `head(key)`, `delete(keys | key[])`, `healthCheck()`, `supportsDirectPresign()`.
- `storage/r2-binding-adapter.ts` — `R2BindingAdapter` — wraps `env.BUCKET` (the Cloudflare R2 native binding). Uses `bucket.createPresignedUrl()` for presign. Zero credentials, zero egress within Cloudflare. `supportsDirectPresign() === true`.
- `storage/s3-compatible-adapter.ts` — `S3CompatibleAdapter` — uses `aws4fetch` for SigV4 signing and HTTP I/O. Works with AWS S3, MinIO, Backblaze B2, R2-via-S3. Presign uses `AwsV4Signer` directly (aws4fetch's `AwsClient.sign` hard-codes `X-Amz-Expires: 86400` for S3, so we pre-seed the URL). `supportsDirectPresign() === false` when the endpoint contains `r2.cloudflarestorage.com` (CORS preflight fails on signed PUTs there).
- `storage/factory.ts` — `getObjectStorage(env, db)` — reads the `global_settings` row, returns `R2BindingAdapter` for `provider='r2-binding'` or `S3CompatibleAdapter` for `provider='s3-compatible'` (after decrypting the access/secret keys with `API_KEY_ENCRYPTION_MASTER`). Falls back to binding when no row exists.
- `storage/schema.ts` — zod discriminated union for the admin PUT endpoint.
- `index.ts` `/api/admin/storage` — GET returns the public fields (with `has_access_key` / `has_secret_key` booleans for the S3 path; never returns decrypted secrets). PUT encrypts the credentials and validates them with a real `put+delete` probe before persisting.

### Cross-Cutting
- `errors.ts` — `ErrorCode` enum + `errorResponse(c, code, message, status, details?)` helper (used by every route).
- `types.ts` — `AppBindings`, `AppVariables`, `AppEnv` (central Hono env types).
- `session.ts` — `SESSION_COOKIE_NAME`, `parseSessionCookie`, `buildSessionCookie`, `clearSessionCookie`, `createSession`, `validateSession`, `deleteSession`.
- `password.ts` — `hashPassword`, `verifyPassword`.
- `invitations.ts` — `createInvitation`, `findValidInvitation`, `consumeInvitation`, `listInvitations`, `revokeInvitation`, `INVITATION_TTL_MS`.
- `crypto.ts` — `encryptApiKey(masterKey, plain)` / `decryptApiKey(masterKey, encrypted)` / `getDecryptedApiKey(env, encrypted)` — AES-256-GCM with 12-byte IV + 16-byte auth tag. Master key loaded from `API_KEY_ENCRYPTION_MASTER` Worker secret.
- `prompts.ts` — `buildRagPrompt(chunks, question)` / `buildGeneralPrompt(query, notesForContext?)` / `validateCitations(text, maxIndex)` / `assessHallucinationRisk(fullText, maxIndex, scores)` / `extractCitations` / `sanitizeCitations` / `buildSummarizationPrompt` / prompt constants `RAG_SYSTEM_PROMPT`, `SUMMARIZATION_SYSTEM_PROMPT`, `GENERAL_SYSTEM_PROMPT` — hallucination guard (citation validity + similarity threshold + risk classification).
- `test/d1-adapter.ts` — `createTestEnv()` returns `{ env, db, sqlite }` with a better-sqlite3 in-memory DB wrapped to mimic D1's API. Re-prepares statements per call (`prepare()` is expensive after `bind()` consumes the statement).
- `test/db.ts` — `createTestDb()` — schema migration helpers.
- `test/auth-helper.ts` — `createAuthedRequest()`, `authedRequest()`, `TEST_SESSION_SECRET` — test auth utilities.

## Route Patterns

### zod validation (M20)
```ts
zValidator('param' | 'json' | 'query', z.object({...}), vHook)
```
- `vHook` is a shared `(result, c) => c.json({ error: `Validation failed: ${msg}` }, 400)` returning `{ error: string }` 400 — matches the frontend's `(body as { error?: string }).error` contract.
- UUID-like path params use `z.string().min(1).max(100)` (not `z.uuid()`) to keep test fixtures (`'nb-1'`, `'user-1'`) valid.

### Authorization (M18)
Every POST/PATCH/DELETE on a notebook-scoped resource does `select id, user_id from notebooks where id = ?` then checks `notebook.user_id !== c.get('user').id` in JS before any write (two-step guard, e.g. `routes/notebooks/crud.ts:178-186`).

### Embedding policy (M21)
For embedding specifically, only `ai_provider: 'workers-ai'` accepted. PATCH /api/notebooks/:id (`routes/notebooks/crud.ts:192-205`) accepts `workers-ai`/`openai`/`anthropic`/`google`/`custom` for chat/OCR but rejects non-`workers-ai` for embedding with a clear 400.

### Cleanup logging (M23)
Storage / Vectorize deletes in source and notebook deletion paths use `.catch(err => console.error(...))` instead of silent `.catch(() => {})`. The new `ObjectStorage.delete()` adapter centralizes this: per-key errors are logged but never thrown, and the binding path issues individual `delete(key)` calls via `Promise.all` (not a single batch call — avoids local Wrangler dev server batch-delete issues, see `r2-binding-adapter.ts:77-96`).

## Subdirectories
| Directory | Responsibility | Map |
|-----------|----------------|-----|
| db/ | drizzle client + RQBv2 relations | [db/codemap.md](db/codemap.md) |
| db/schema/ | Per-table schema definitions | [db/schema/codemap.md](db/schema/codemap.md) |
| middleware/ | Hono middleware | [middleware/codemap.md](middleware/codemap.md) |
| routes/ | Hono route handlers (auth, chat, notes, connections, settings, debug, notebooks/, sources/) | — |
| providers/ | AI provider classes + factories (workers-ai, openai, anthropic, google, base, index) | — |
| storage/ | ObjectStorage interface + R2/S3 adapters + factory | — |
| test/ | vitest fixtures (D1 adapter) | — (test only) |