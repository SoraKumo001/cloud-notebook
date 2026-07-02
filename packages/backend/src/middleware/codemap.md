# packages/backend/src/middleware/

## Responsibility
Hono middleware factories used by `index.ts` to inject cross-cutting concerns into the request context.

## Files

### db.ts
- Exports `dbMiddleware(): MiddlewareHandler<{ Bindings: { DB: D1Database }; Variables: { db: DB } }>`.
- Creates a drizzle instance via `createDb(c.env.DB)` and sets it as `c.get('db')`.
- Mounted with `app.use('/api/*', dbMiddleware() as any)` in `index.ts`.
- The `as any` cast is intentional: Hono's `MiddlewareHandler` generics are too narrow to express our typed Variables cleanly with the `(as any)` on `createDb`; the runtime behaviour is fully typed.

### storage.ts
- Exports `storageMiddleware(): MiddlewareHandler<{ Bindings: StorageEnv; Variables: { db: DB; storage: ObjectStorage } }>`.
- Resolves the active `ObjectStorage` adapter via `getObjectStorage(c.env, c.get('db'))` (see `src/storage/factory.ts`) and sets it as `c.get('storage')`.
- Tests inject a mock via `c.env.__storage` to bypass the factory.
- Mounted with `app.use('/api/*', storageMiddleware() as any)` in `index.ts` (after `dbMiddleware`).

### auth (parent: `src/auth.ts`)
- `authMiddleware` is the auth equivalent — exported from `src/auth.ts` (not a middleware file) and mounted in `index.ts`. See [src/codemap.md](../codemap.md).