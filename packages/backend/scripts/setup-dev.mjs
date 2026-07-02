#!/usr/bin/env node
// Local setup for development environment.
// D1 / R2 use local miniflare emulation (no Cloudflare resources created);
// only Vectorize index (cloud-notebook-vector-bge-dev, 1024-dim cosine) is
// created on Cloudflare via the API. Applies pending D1 migrations to the
// local SQLite database. Idempotent.
//
// Differences from setup-production.mjs:
//   - D1 / R2 are NOT created on Cloudflare (local miniflare emulation)
//   - database_id is set to the placeholder (YOUR_D1_DATABASE_ID_HERE)
//     so wrangler dev uses a local SQLite database
//   - database_name / bucket_name use prod names (no -dev suffix) because
//     local emulation doesn't need separate resource names
//   - Vectorize index uses -dev suffix (cloud-notebook-vector-bge-dev)
//     with remote: true, created on Cloudflare
//   - Writes directly to wrangler.jsonc (not wrangler.production.jsonc)
//   - No secrets handling (.dev.vars is sufficient for dev)
//   - Migrations use --local flag (local SQLite, not remote D1)
//
// Idempotent — safe to re-run; existing resources are detected and
// skipped. Requires `wrangler` to be authenticated (for Vectorize API).
//
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendDir = join(__dirname, '..')
const wranglerJsonc = join(backendDir, 'wrangler.jsonc')
const devVarsExample = join(backendDir, '.dev.vars.example')
const devVars = join(backendDir, '.dev.vars')

const vectorizeName = 'cloud-notebook-vector-bge-dev'
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

async function resetWranglerConfigToLocalTemplate() {
  const raw = await readFile(wranglerJsonc, 'utf8')
  const config = JSON.parse(raw)
  let changed = false

  // database_id must be the placeholder for local emulation
  if (config.d1_databases?.[0]?.database_id !== 'YOUR_D1_DATABASE_ID_HERE') {
    config.d1_databases[0].database_id = 'YOUR_D1_DATABASE_ID_HERE'
    changed = true
  }

  // database_name should be the prod name (no -dev suffix) for local emulation
  if (config.d1_databases?.[0]?.database_name !== 'cloud-notebook-db') {
    config.d1_databases[0].database_name = 'cloud-notebook-db'
    changed = true
  }

  // bucket_name should be the prod name (no -dev suffix) for local emulation
  if (config.r2_buckets?.[0]?.bucket_name !== 'cloud-notebook-bucket') {
    config.r2_buckets[0].bucket_name = 'cloud-notebook-bucket'
    changed = true
  }

  if (changed) {
    await writeFile(wranglerJsonc, JSON.stringify(config, null, '\t'))
    console.log(`Normalized ${wranglerJsonc} to local dev template`)
  } else {
    console.log(`${wranglerJsonc} already in local dev template state`)
  }
}

async function applyMigrationsLocal() {
  // Local D1 (miniflare SQLite) — no retry needed, fast and reliable.
  const cmd = 'wrangler d1 migrations apply DB --local'
  console.log(`> ${cmd}`)
  try {
    execSync(cmd, {
      cwd: backendDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    console.log('Migrations applied successfully to local D1')
  } catch (err) {
    throw new Error(`Local migration failed: ${(err.stderr || err.stdout || err.message).trim()}`)
  }
}

async function ensureDevVars() {
  if (existsSync(devVars)) {
    console.log(`.dev.vars already exists (skipped copy)`)
    return
  }
  if (!existsSync(devVarsExample)) {
    throw new Error(
      `.dev.vars.example not found at ${devVarsExample}; cannot create .dev.vars`,
    )
  }
  await copyFile(devVarsExample, devVars)
  console.log(`Copied .dev.vars.example → .dev.vars (with dummy secrets)`)
}

async function main() {
  // .dev.vars must exist before wrangler dev is started (it is read on
  // boot). Set it up first so a developer who runs setup:dev and then
  // pnpm dev back-to-back gets a working dev environment.
  await ensureDevVars()

  // Normalize wrangler.jsonc to local dev template (idempotent)
  await resetWranglerConfigToLocalTemplate()

  // Create Vectorize index on Cloudflare (only remote resource needed)
  await ensureVectorizeIndex()

  // Apply migrations to local D1 (miniflare SQLite)
  console.log('\nApplying database migrations to local D1...')
  await applyMigrationsLocal()

  // Secrets are not set here. Use .dev.vars for local development.
  // See .dev.vars.example for the required variables.

  console.log('\nDev setup complete. Run `pnpm --filter backend dev` to start.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
