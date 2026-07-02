import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import { relations } from './relations'

export type DB = DrizzleD1Database<typeof relations>

export const createDb = (binding: D1Database): DB => drizzle(binding, { relations })
