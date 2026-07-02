import type { MiddlewareHandler } from 'hono'
import { createDb, type DB } from '../db/client'

export const dbMiddleware = (): MiddlewareHandler<{
  Bindings: { DB: D1Database }
  Variables: { db: DB }
}> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (async (c: any, next: any) => {
    c.set('db', createDb(c.env.DB))
    await next()
  }) as any
