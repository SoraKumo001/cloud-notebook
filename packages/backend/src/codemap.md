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
8. **`app.onError`** — in dev returns `{ error, stack }`; in prod returns `{ error: 'Internal Server Error' }` only.

## Module Map

### Routes & Entry
- `index.ts` — every route (notebooks, sources, notes, sessions, mcp-token, chat SSE, `/api/auth/logout` redirecting to Cloudflare Access logout endpoint).
- `mcp.ts` — MCP Streamable HTTP transport (`WebStandardStreamableHTTPServerTransport`, `enableJsonResponse: true`, stateless). One `McpServer` + transport per request. Delegates JSON-RPC dispatch to the SDK.

### Middleware
- `auth.ts` — `authMiddleware`, `getAuthContext`, `requireAdmin`. Email + password with HMAC-signed session cookies.
- `middleware/db.ts` — `dbMiddleware()` creates a drizzle instance from the D1 binding and exposes it via `c.get('db')`.
- `middleware/storage.ts` — `storageMiddleware()` reads the `global_settings` row, decrypts any S3-compatible secrets, and attaches the active `ObjectStorage` adapter via `c.get('storage')`. Tests inject a mock via `env.__storage` to bypass the factory.

### Business Logic
- `chat.ts` — `streamChat()` SSE RAG pipeline: `embedQuery(env, query)` → Vectorize top-K (`VECTORIZE_TOP_K = 8`) with `filter: { notebook_id: { $eq } }` → JOIN chunks+sources in D1 (M15.2) → LLM stream → write SSE events `meta` / `delta` / `done` / `error`. Auto-reindex path when Vectorize returns 0 matches. `db.batch()` for chatSessions + chatMessages insert (M17 atomicity).
- `mcp-tools.ts` — `registerTools(server, env, notebook)` registers 6 tools (list_sources, get_source, search_sources, list_chat_sessions, get_chat_history, chat) with **Zod shapes** for argument validation. Embeddings via `embedQuery`, RAG chat via `chatViaRag` (parses SSE into JSON).
- `mcp-auth.ts` — `mcpAuthMiddleware`: Bearer token lookup against `notebooks.mcp_token` (partial unique index). Sets `c.get('notebook')`.

### AI Providers
- `providers.ts` — `getChatProvider` / `getEmbedProvider` / `getScriptProvider` factory. Classes: `WorkersAIChatProvider` / `WorkersAIEmbedProvider` / `WorkersAIScriptProvider`, `OpenAIChatProvider` / `OpenAIScriptProvider`, `AnthropicChatProvider` / `AnthropicScriptProvider`, `GoogleChatProvider` / `GoogleScriptProvider`. **`OpenAIEmbedProvider`/`GoogleEmbedProvider` removed in M21** (1024-dim guard).
- `embeddings.ts` — `getEmbeddingProvider(env, notebook)` — **only `workers-ai` accepted** (M21). `OpenAI`/`Google`/`Anthropic` throw with actionable error messages. Also exports `embedChunks(env, chunks, opts)` (Promise pool concurrency, batch size 32, exponential backoff on 429/5xx) and `embedQuery(env, query)` (Workers AI bge-large-en-v1.5).

### Object Storage (M24+)
- `storage/interface.ts` — `ObjectStorage` interface: `presign(key, ct, expSec)`, `put(key, body, ct)`, `head(key)`, `delete(keys | key[])`, `healthCheck()`, `supportsDirectPresign()`.
- `storage/r2-binding-adapter.ts` — `R2BindingAdapter` — wraps `env.BUCKET` (the Cloudflare R2 native binding). Uses `bucket.createPresignedUrl()` for presign. Zero credentials, zero egress within Cloudflare. `supportsDirectPresign() === true`.
- `storage/s3-compatible-adapter.ts` — `S3CompatibleAdapter` — uses `aws4fetch` for SigV4 signing and HTTP I/O. Works with AWS S3, MinIO, Backblaze B2, R2-via-S3. Presign uses `AwsV4Signer` directly (aws4fetch's `AwsClient.sign` hard-codes `X-Amz-Expires: 86400` for S3, so we pre-seed the URL). `supportsDirectPresign() === false` when the endpoint contains `r2.cloudflarestorage.com` (CORS preflight fails on signed PUTs there).
- `storage/factory.ts` — `getObjectStorage(env, db)` — reads the `global_settings` row, returns `R2BindingAdapter` for `provider='r2-binding'` or `S3CompatibleAdapter` for `provider='s3-compatible'` (after decrypting the access/secret keys with `API_KEY_ENCRYPTION_MASTER`). Falls back to binding when no row exists.
- `storage/schema.ts` — zod discriminated union for the admin PUT endpoint.
- `index.ts` `/api/admin/storage` — GET returns the public fields (with `has_access_key` / `has_secret_key` booleans for the S3 path; never returns decrypted secrets). PUT encrypts the credentials and validates them with a real `put+delete` probe before persisting.

### Cross-Cutting
- `crypto.ts` — `encryptApiKey(masterKey, plain)` / `decryptApiKey(masterKey, encrypted)` — AES-256-GCM with 12-byte IV + 16-byte auth tag. Master key loaded from `API_KEY_ENCRYPTION_MASTER` Worker secret.
- `prompts.ts` — `buildRagPrompt(chunks, question)` / `buildGeneralPrompt(question)` / `validateCitations(text, maxIndex)` / `assessHallucinationRisk(answer, chunks, citationThreshold)` — hallucination guard (citation validity + similarity threshold + risk classification).
- `test/d1-adapter.ts` — `createTestEnv()` returns `{ env, db, sqlite }` with a better-sqlite3 in-memory DB wrapped to mimic D1's API. Re-prepares statements per call (`prepare()` is expensive after `bind()` consumes the statement).
- `test/db.ts` — schema migration helpers.

## Route Patterns

### zod validation (M20)
```ts
zValidator('param' | 'json' | 'query', z.object({...}), vHook)
```
- `vHook` is a shared `(result, c) => c.json({ error: `Validation failed: ${msg}` }, 400)` returning `{ error: string }` 400 — matches the frontend's `(body as { error?: string }).error` contract.
- UUID-like path params use `z.string().min(1).max(100)` (not `z.uuid()`) to keep test fixtures (`'nb-1'`, `'user-1'`) valid.

### Authorization (M18)
Every POST/PATCH/DELETE on a notebook-scoped resource does `select user_id from notebooks where id = ? and user_id = c.get('user').id` before any write.

### Embedding policy (M21)
Only `ai_provider: 'workers-ai'` accepted. PATCH /api/notebooks/:id rejects others with a clear 400.

### Cleanup logging (M23)
Storage / Vectorize deletes in source and notebook deletion paths use `.catch(err => console.error(...))` instead of silent `.catch(() => {})`. The new `ObjectStorage.delete()` adapter centralizes this: per-key errors are logged but never thrown, and the binding path batches all keys in one call.

## Subdirectories
| Directory | Responsibility | Map |
|-----------|----------------|-----|
| db/ | drizzle client + RQBv2 relations | [db/codemap.md](db/codemap.md) |
| db/schema/ | Per-table schema definitions | [db/schema/codemap.md](db/schema/codemap.md) |
| middleware/ | Hono middleware | [middleware/codemap.md](middleware/codemap.md) |
| test/ | vitest fixtures (D1 adapter) | — (test only) |