import type { Ai, R2Bucket, VectorizeIndex } from '@cloudflare/workers-types'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { relations } from '../db/relations'

type TestDB = BetterSQLite3Database<typeof relations>

/**
 * D1-compatible adapter that wraps better-sqlite3.
 *
 * drizzle-orm/d1 calls `client.prepare(sql).bind(...params).raw() / .all() / .first() / .run()`.
 *
 * better-sqlite3 limitations we work around:
 *   1. `stmt.bind()` consumes the statement; rebind throws.
 *   2. `stmt.bind([])` throws; only `stmt.bind()` (no args) works for 0-param queries.
 *   3. `stmt.raw()` exists and returns a raw-rows helper.
 *
 * We therefore re-prepare on every method call instead of caching — matches the D1
 * contract where each `prepare()` returns an independent statement.
 */
function createD1Adapter(sqlite: Database.Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    function bindOnce(...params: unknown[]) {
      const passedParams = params

      return {
        all: async <T = unknown>(): Promise<{
          results: T[]
          success: boolean
          meta: Record<string, unknown>
        }> => {
          const stmt = sqlite.prepare(sql)
          const results = (
            passedParams.length === 0 ? stmt.all() : stmt.all(...passedParams)
          ) as T[]
          return { results, success: true, meta: {} }
        },
        first: async <T = unknown>(): Promise<T | null> => {
          const stmt = sqlite.prepare(sql)
          const row = (passedParams.length === 0 ? stmt.get() : stmt.get(...passedParams)) as
            | T
            | undefined
          return row ?? null
        },
        run: async (): Promise<D1Result> => {
          const stmt = sqlite.prepare(sql)
          const info = passedParams.length === 0 ? stmt.run() : stmt.run(...passedParams)
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
              duration: 0,
              size_after: 0,
              rows_read: 0,
              rows_written: info.changes,
              changed_db: false,
            } as unknown as D1Meta & Record<string, unknown>,
            results: [],
          }
        },
        raw: async <T = unknown>(): Promise<T[]> => {
          const stmt = sqlite.prepare(sql)
          const rows =
            passedParams.length === 0
              ? (stmt.raw().all() as T[][])
              : (stmt.raw().all(...passedParams) as T[][])
          return rows as T[]
        },
      }
    }

    return {
      bind: (...params: unknown[]) => bindOnce(...params),
      all: async () => {
        const stmt = sqlite.prepare(sql)
        return { results: stmt.all(), success: true, meta: {} }
      },
      first: async () => sqlite.prepare(sql).get() ?? null,
      run: async () => {
        const info = sqlite.prepare(sql).run()
        return {
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid),
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: info.changes,
            changed_db: false,
          } as unknown as D1Meta & Record<string, unknown>,
          results: [],
        }
      },
      raw: async () => sqlite.prepare(sql).raw().all(),
    } as unknown as D1PreparedStatement
  }

  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]): Promise<D1Result[]> => {
      const results: D1Result[] = []
      for (const stmt of statements) {
        const result = await (stmt as unknown as { run: () => Promise<D1Result> }).run()
        results.push(result)
      }
      return results
    },
    exec: async (sql: string): Promise<unknown> => {
      sqlite.exec(sql)
      return {}
    },
    dump: async (): Promise<ArrayBuffer> => {
      const buf = sqlite.serialize()
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
  } as unknown as D1Database
}

/**
 * Creates a test environment with:
 * - A real in-memory SQLite database (via better-sqlite3)
 * - Drizzle schema migrated
 * - A D1-compatible adapter so `createDb(c.env.DB)` works in handlers
 *
 * Usage:
 *   const { env, db, sqlite } = createTestEnv()
 *   // Insert test data:
 *   await db.insert(notebooks).values({ id: 'nb-1', ... })
 *   // Call the app:
 *   const res = await app.fetch(new Request('http://localhost/api/notebooks'), env)
 */
import type { AuthedEnv } from './auth-helper'

export function createTestEnv(): {
  env: AuthedEnv
  db: TestDB
  sqlite: Database.Database
} {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')

  const db = drizzle({ client: sqlite, relations })
  migrate(db, { migrationsFolder: './drizzle' })

  const d1 = createD1Adapter(sqlite)

  const env: AuthedEnv = {
    DB: d1,
    BUCKET: {} as R2Bucket,
    VECTORIZE: {} as VectorizeIndex,
    AI: {} as Ai,
    SESSION_SECRET: 'test-secret-please-do-not-use-in-prod-32+chars-long',
    API_KEY_ENCRYPTION_MASTER: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
    // Default storage mock — every test gets a no-op ObjectStorage
    // out of the box, so tests don't have to set up the storage
    // path unless they specifically exercise it. Tests that need
    // behavior can replace this with a custom mock.
    __storage: {
      provider: 'r2-binding',
      presign: async () => ({
        url: 'https://mock-presigned.example/k',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
      put: async () => ({ etag: 'mock-etag', size: 0 }),
      head: async () => null,
      get: async () => null,
      delete: async () => undefined,
      healthCheck: async () => undefined,
      supportsDirectPresign: () => true,
    },
  }

  return { env, db, sqlite }
}
