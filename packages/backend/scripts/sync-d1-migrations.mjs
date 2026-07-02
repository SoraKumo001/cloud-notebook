// Sync drizzle-kit v3 subfolder migrations to flat format for wrangler d1 migrations apply.
// Reads drizzle/<timestamp>_<name>/migration.sql and writes drizzle/migrations/<timestamp>_<name>.sql
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(__dirname, '..', 'drizzle')
const migrationsDir = join(drizzleDir, 'migrations')

const entries = await readdir(drizzleDir, { withFileTypes: true })
const subdirs = entries.filter((e) => e.isDirectory() && e.name !== 'migrations')

if (subdirs.length === 0) {
  console.log('No migration subdirectories found in', drizzleDir)
  process.exit(0)
}

await mkdir(migrationsDir, { recursive: true })

for (const dir of subdirs) {
  const sqlPath = join(drizzleDir, dir.name, 'migration.sql')
  let sql
  try {
    sql = await readFile(sqlPath, 'utf8')
  } catch {
    console.warn(`Skipping ${dir.name}: migration.sql not found`)
    continue
  }
  const outPath = join(migrationsDir, `${dir.name}.sql`)
  await writeFile(outPath, sql, 'utf8')
  console.log(`Synced: ${dir.name}/migration.sql -> migrations/${dir.name}.sql`)
}

console.log(`Done. ${subdirs.length} migration(s) synced to ${migrationsDir}`)
