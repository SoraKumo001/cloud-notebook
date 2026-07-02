import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { relations } from '../db/relations'

type TestDB = BetterSQLite3Database<typeof relations>

/**
 * Creates an in-memory SQLite database with drizzle schema applied.
 * Use in tests as a real D1-compatible database for integration testing.
 *
 * Note: drizzle-orm 1.0.0-rc.4 better-sqlite3 driver requires
 * `drizzle({ client: sqlite })` — NOT `drizzle(sqlite)` (breaking change from 0.x).
 */
export function createTestDb(): { db: TestDB; sqlite: Database.Database } {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle({ client: sqlite, relations })
  migrate(db, { migrationsFolder: './drizzle' })
  return { db, sqlite }
}
