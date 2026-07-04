import type { MiddlewareHandler } from 'hono'
import { createDb } from '../db/client'
import type { AppBindings, AppVariables } from '../types'

export const dbMiddleware = (): MiddlewareHandler<{
  Bindings: AppBindings
  Variables: AppVariables
}> => {
  return async (c, next) => {
    c.set('db', createDb(c.env.DB))
    await next()
  }
}
