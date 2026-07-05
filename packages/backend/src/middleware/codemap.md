# packages/backend/src/middleware/

## Responsibility
Hono middleware factories used by `index.ts` to inject cross-cutting concerns into the request context.

## Files

### db.ts
- Exports `dbMiddleware(): MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>` (shared types from `types.ts`).
- Creates a drizzle instance via `createDb(c.env.DB)` and sets it as `c.get('db')`.
- Mounted with `app.use('/api/*', dbMiddleware())` in `index.ts:36`.

### storage.ts
- Exports `storageMiddleware(): MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>` (same shared types). The `StorageEnv` type used by the factory lives in `storage/factory.ts:24-29` as a parameter type, not a Hono binding generic.
- Resolves the active `ObjectStorage` adapter via `getObjectStorage(c.env, c.get('db'))` (see `src/storage/factory.ts`) and sets it as `c.get('storage')`.
- Tests inject a mock via `c.env.__storage` to bypass the factory.
- Mounted with `app.use('/api/*', storageMiddleware())` in `index.ts:40` (after `dbMiddleware`).

### auth (parent: `src/auth.ts`)
- `authMiddleware` is the auth equivalent — exported from `src/auth.ts` (not a middleware file) and mounted in `index.ts`. See [src/codemap.md](../codemap.md).