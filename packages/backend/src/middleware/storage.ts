// packages/backend/src/middleware/storage.ts
//
// Per-request middleware that resolves the active ObjectStorage adapter
// and attaches it to the Hono context as `c.get('storage')`.
//
// The factory is called once per request; D1 reads are cheap and we
// want any admin change to take effect on the very next request. The
// adapter instance itself is constructed fresh each request — both
// adapters are essentially stateless (the binding is held by the
// runtime, aws4fetch holds only a tiny AwsClient), so caching the
// instance would not save much and would complicate credential
// rotation.

import type { MiddlewareHandler } from 'hono'
import type { DB } from '../db/client'
import { getObjectStorage, type StorageEnv } from '../storage/factory'
import type { ObjectStorage } from '../storage/interface'

export const storageMiddleware = (): MiddlewareHandler<{
  Bindings: StorageEnv
  Variables: { db: DB; storage: ObjectStorage }
}> => {
  return async (c, next) => {
    // Test override: when tests inject `__storage` into the env, use it
    // directly. This avoids needing to seed the global_settings row in
    // every test that exercises the storage path.
    if (c.env.__storage) {
      c.set('storage', c.env.__storage as ObjectStorage)
    } else {
      const storage = await getObjectStorage(c.env, c.get('db'))
      c.set('storage', storage)
    }
    await next()
  }
}
