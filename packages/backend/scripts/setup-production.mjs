#!/usr/bin/env node
// Local setup for production deployment.
// Creates D1 database, R2 bucket, and Vectorize index (with the
// notebook_id and source_id metadata indexes); writes
// wrangler.production.jsonc with the real database_id; and applies
// pending D1 migrations. Idempotent — safe to re-run; existing
// resources are detected and skipped. Requires `wrangler` to be
// authenticated.
//
import { randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendDir = join(__dirname, '..')
const wranglerJsonc = join(backendDir, 'wrangler.jsonc')
const productionJsonc = join(backendDir, 'wrangler.production.jsonc')

const dbName = 'cloud-notebook-db'
const bucketName = 'cloud-notebook-bucket'
const vectorizeName = 'cloud-notebook-vector-bge'
const vectorizeMetadataIndexes = [
  { propertyName: 'notebook_id', type: 'string' },
  { propertyName: 'source_id', type: 'string' },
]

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  return execSync(cmd, {
    cwd: backendDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    ...opts,
  })
}

function tryRun(cmd) {
  try {
    execSync(cmd, {
      cwd: backendDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

function tryRunVerbose(cmd) {
  try {
    const stdout = execSync(cmd, {
      cwd: backendDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, stdout, stderr: '' }
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
    }
  }
}

function extractDatabaseId(output) {
  // Wrangler 4.x prints a JSON config snippet that includes
  // "database_id": "<UUID>". The snippet is plain JSON when the project
  // uses wrangler.json/wrangler.jsonc, which this repo does.
  // We use a regex to extract just the UUID (not full JSON.parse, because
  // the snippet may be embedded in user-facing text with banners).
  const match = output.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)
  if (!match) {
    throw new Error('Could not extract database_id from wrangler d1 create output')
  }
  return match[1]
}

async function findOrCreateD1() {
  // Wrangler 4.x: use --json for a parseable array of {uuid, name, ...}.
  const listText = run(`wrangler d1 list --json`, { stdio: ['pipe', 'pipe', 'pipe'] })
  let databases
  try {
    databases = JSON.parse(listText)
  } catch (err) {
    throw new Error(`Failed to parse wrangler d1 list --json output: ${err.message}`)
  }
  const existing = databases.find((db) => db.name === dbName)
  if (existing?.uuid) {
    console.log(`D1 database "${dbName}" already exists: ${existing.uuid}`)
    return existing.uuid
  }
  // Create — wrangler 4.x prints a JSON config snippet. extractDatabaseId
  // pulls the UUID out of it.
  const createdText = run(`wrangler d1 create ${dbName}`)
  const databaseId = extractDatabaseId(createdText)
  console.log(`Created D1 database "${dbName}": ${databaseId}`)
  return databaseId
}

async function ensureR2Bucket() {
  if (tryRun(`wrangler r2 bucket info ${bucketName}`)) {
    console.log(`R2 bucket "${bucketName}" already exists`)
    return
  }
  run(`wrangler r2 bucket create ${bucketName}`)
  console.log(`Created R2 bucket "${bucketName}"`)
}

async function ensureVectorizeMetadataIndexes() {
  for (const { propertyName, type } of vectorizeMetadataIndexes) {
    const cmd = `wrangler vectorize create-metadata-index ${vectorizeName} --property-name=${propertyName} --type=${type}`
    const result = tryRunVerbose(cmd)
    if (result.ok) {
      console.log(`Metadata index "${propertyName}" (${type}) created on "${vectorizeName}"`)
    } else {
      // Failure is expected if the metadata index already exists.
      // Surface the stderr so the operator can debug unexpected failures.
      const stderr = (result.stderr || '').trim()
      const alreadyExists = /already exists/i.test(stderr) || /already exists/i.test(result.stdout)
      if (alreadyExists) {
        console.log(`Metadata index "${propertyName}" (${type}) already exists on "${vectorizeName}"`)
      } else {
        console.error(`Failed to create metadata index "${propertyName}" (${type}) on "${vectorizeName}":`)
        console.error(stderr || result.stdout)
        throw new Error(`Failed to create metadata index "${propertyName}"`)
      }
    }
  }
}

async function ensureVectorizeIndex() {
  const isFresh = !tryRun(`wrangler vectorize get ${vectorizeName}`)
  if (isFresh) {
    run(`wrangler vectorize create ${vectorizeName} --dimensions 1024 --metric cosine`)
    console.log(`Created Vectorize index "${vectorizeName}"`)
  } else {
    console.log(`Vectorize index "${vectorizeName}" already exists`)
  }
  // Always ensure the metadata indexes exist, regardless of whether
  // we just created the vector index or it pre-existed. Required for
  // chat filtering by notebook_id to work correctly.
  await ensureVectorizeMetadataIndexes()
}

async function writeProductionConfig(databaseId) {
  const raw = await readFile(wranglerJsonc, 'utf8')
  const config = JSON.parse(raw)
  config.d1_databases[0].database_id = databaseId
  delete config.build
  await writeFile(productionJsonc, JSON.stringify(config, null, '\t'))
  console.log(`Wrote ${productionJsonc} with database_id ${databaseId}`)
}

async function applyMigrationsWithRetry(retries = 3, delayMs = 2000) {
  const cmd = `wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc`
  for (let attempt = 1; attempt <= retries; attempt++) {
    const result = tryRunVerbose(cmd)
    if (result.ok) {
      console.log('Migrations applied successfully')
      return
    }
    const isLast = attempt === retries
    if (isLast) {
      throw new Error(
        `Migrations failed after ${retries} attempts: ${(result.stderr || result.stdout).trim()}`,
      )
    }
    console.log(`Migration attempt ${attempt} failed, retrying in ${delayMs / 1000}s...`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

async function ensureSecrets() {
  const secretsSpec = [
    { name: 'SESSION_SECRET', description: 'HMAC key for session cookies' },
    { name: 'API_KEY_ENCRYPTION_MASTER', description: 'AES-GCM master key for encrypting stored API keys and S3 credentials' },
  ]

  // List existing secrets via the same wrangler secret list approach
  // used by setup-secrets.mjs. Since wrangler secret list --json is unreliable
  // across versions, we use tryRunVerbose and attempt JSON parse, falling back
  // to an empty set.
  const existingCmd = `wrangler secret list --config wrangler.production.jsonc`
  const existingResult = tryRunVerbose(existingCmd)
  let existing = new Set()
  if (existingResult.ok && existingResult.stdout.trim()) {
    try {
      const parsed = JSON.parse(existingResult.stdout)
      if (Array.isArray(parsed)) {
        existing = new Set(parsed.map((s) => s.name))
      }
    } catch {
      // Non-JSON output (older wrangler versions): parse line-by-line
      for (const line of existingResult.stdout.split('\n')) {
        const name = line.trim()
        if (name) existing.add(name)
      }
    }
  }

  let setCount = 0
  for (const spec of secretsSpec) {
    if (existing.has(spec.name)) {
      console.log(`Secret "${spec.name}" already set (skipping)`)
      continue
    }
    const value = randomBytes(32).toString('base64')
    run(`wrangler secret put ${spec.name} --config wrangler.production.jsonc`, { input: value })
    console.log(`Set "${spec.name}"`)
    setCount++
  }

  if (setCount === 0) {
    console.log('All required secrets already set or already exist.')
  } else {
    console.log(`Set ${setCount} new secret(s).`)
  }
}

async function main() {
  const databaseId = await findOrCreateD1()
  await ensureR2Bucket()
  await ensureVectorizeIndex()

  if (!existsSync(productionJsonc)) {
    await writeProductionConfig(databaseId)
  } else {
    console.log(`Production config already exists: ${productionJsonc} (skipping write)`)
  }

  // Apply migrations (idempotent — re-runs are no-ops for already-applied ones)
  console.log('\nApplying database migrations...')
  await applyMigrationsWithRetry()

  // Set Worker secrets (idempotent — skips already-set ones)
  console.log('\nSetting Worker secrets...')
  await ensureSecrets()

  console.log('\nSetup complete. Deploy:')
  console.log('  pnpm run deploy')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
