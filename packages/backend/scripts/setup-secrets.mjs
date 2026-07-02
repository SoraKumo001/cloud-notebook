#!/usr/bin/env node
// One-time local setup for Worker secrets.
//
// ===========================================================================
// What this script sets
// ===========================================================================
//  - SESSION_SECRET           32-byte base64 HMAC key for session cookies.
//                             Auto-generated if missing (or set via env).
//                             Rotating it logs every user out.
//
//  - API_KEY_ENCRYPTION_MASTER  32-byte base64 AES-GCM key for encrypting
//                             per-user API keys AND S3-compatible storage
//                             credentials at rest. Auto-generated if
//                             missing. Rotating it invalidates every stored
//                             key (users must re-enter them) and requires
//                             re-entering S3 credentials via the admin UI.
//
//  - R2 / S3 credentials are NOT set here. They are configured at runtime
//    via the admin UI (GET/PUT /api/admin/storage), which writes them to
//    the `global_settings` D1 table encrypted with API_KEY_ENCRYPTION_MASTER.
//    The Worker can also be configured to use the Cloudflare R2 native
//    binding (no credentials) via `r2-binding` provider.
//
// ===========================================================================
// Modes
// ===========================================================================
//  - Default (interactive): prompts for any value not provided via env vars.
//    Secrets that cannot be generated prompt; secrets that can be
//    auto-generated (SESSION_SECRET, API_KEY_ENCRYPTION_MASTER) do not.
//
//  - Non-interactive: triggered by `CI=true`, `--non-interactive`, or when
//    stdin is not a TTY. In this mode any required value that cannot be
//    read from env or auto-generated is a hard error. Existing secrets are
//    either skipped (default) or overwritten with `--force`.
//
// ===========================================================================
// Usage
// ===========================================================================
//   pnpm run setup:secrets
//     Interactive: prompts only for values you didn't supply as env vars.
//
//   pnpm run setup:secrets -- --non-interactive
//     CI mode: every required value must come from env or auto-generation.
//
//   pnpm run setup:secrets -- --force
//     Overwrite existing secrets (in interactive mode this also confirms
//     each one).
//
//   pnpm run setup:secrets -- --skip-existing
//     Leave already-set secrets alone.
//
// ===========================================================================
// Required environment variables (preferred over prompts)
// ===========================================================================
//   SESSION_SECRET, API_KEY_ENCRYPTION_MASTER
//
// Requires `wrangler.production.jsonc` and `wrangler` to be authenticated.

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { isatty } from 'node:tty'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendDir = join(__dirname, '..')
const productionJsonc = join(backendDir, 'wrangler.production.jsonc')

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const force = argv.includes('--force') || process.env.WRANGLE_FORCE === '1'
const skipExisting = argv.includes('--skip-existing')
const nonInteractiveFlag = argv.includes('--non-interactive')
const nonInteractive =
  nonInteractiveFlag || process.env.CI === 'true' || !isatty(0)

if (force && skipExisting) {
  console.error('Error: --force and --skip-existing are mutually exclusive.')
  process.exit(2)
}

const secretsSpec = [
  {
    name: 'SESSION_SECRET',
    env: 'SESSION_SECRET',
    description: 'HMAC key for signing session cookies (auto-generated if missing)',
    longHint:
      'A 32-byte base64 secret used to HMAC-sign the `session` cookie. Auto-generated if absent.',
    generate: () => randomBytes(32).toString('base64'),
    required: true,
  },
  {
    name: 'API_KEY_ENCRYPTION_MASTER',
    env: 'API_KEY_ENCRYPTION_MASTER',
    description: 'AES-GCM master key for encrypting stored API keys (auto-generated if missing)',
    longHint:
      'A 32-byte base64 AES-GCM key that wraps the per-user API keys AND ' +
      'S3-compatible storage credentials stored in D1. Auto-generated if absent. ' +
      'Rotating it forces every user to re-enter their API key and requires ' +
      're-entering S3 credentials via the admin UI.',
    generate: () => randomBytes(32).toString('base64'),
    required: true,
  },
]

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function run(cmd, input) {
  console.log(`> ${cmd}`)
  return execSync(cmd, {
    cwd: backendDir,
    encoding: 'utf8',
    input,
  })
}

function listSecrets() {
  try {
    const out = run(`wrangler secret list --config wrangler.production.jsonc`)
    if (!out || !out.trim()) return []
    try {
      const parsed = JSON.parse(out)
      if (Array.isArray(parsed)) return parsed.map((s) => s.name)
    } catch {
      // fall through
    }
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function resolveValue(spec) {
  // 1. Environment variable (preferred)
  const fromEnv = process.env[spec.env]
  if (fromEnv && fromEnv.length > 0) {
    console.log(`Using ${spec.name} from env var ${spec.env}`)
    return fromEnv
  }

  // 2. Auto-detection (e.g. ACCOUNT_ID via wrangler whoami)
  if (spec.detect) {
    const detected = spec.detect()
    if (detected) return detected
  }

  // 3. Auto-generation (where supported)
  if (spec.generate) {
    const value = spec.generate()
    console.log(`Auto-generated ${spec.name} (store it in your password manager)`)
    return value
  }

  // 4. Hard default (where provided)
  const defaultValue = typeof spec.default === 'function' ? spec.default() : spec.default
  if (defaultValue && nonInteractive) {
    console.log(`Using default value for ${spec.name}`)
    return defaultValue
  }

  // 5. Interactive prompt
  if (nonInteractive) {
    if (spec.required) {
    throw new Error(
      `${spec.name} is required: set the ${spec.env} env var or pass it via the command line.`,
    )
  }
  return defaultValue ?? ''
}

  if (spec.longHint) {
    console.error(`\n── ${spec.name} ──`)
    const hintText = typeof spec.longHint === 'function' ? spec.longHint() : spec.longHint
    console.error(hintText)
  }
  const hint = spec.example ? ` (e.g. ${spec.example})` : ''
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  const answer = await ask(`\n${spec.description}${hint}${suffix}: `)
  if (answer.length > 0) return answer
  if (defaultValue) return defaultValue
  if (spec.required) throw new Error(`${spec.name} is required`)
  return ''
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(productionJsonc)) {
    console.error(
      `Production config not found: ${productionJsonc}\nRun \`pnpm setup:production\` first.`,
    )
    process.exit(1)
  }

  console.log('===================================================================')
  console.log('Worker secrets setup')
  console.log('===================================================================')
  console.log('The following values will be written to the Cloudflare Worker:')
  console.log('')
  for (const spec of secretsSpec) {
    const source = spec.generate
      ? 'auto-generated'
      : spec.default
        ? 'default available (press Enter)'
        : 'you provide it'
    console.log(`  • ${spec.name.padEnd(28)} ${source}`)
  }
  console.log('')
  console.log('R2 / S3 storage credentials are NOT set here.')
  console.log('  Configure them after deploy via the admin UI (Storage Settings)')
  console.log('  or via PUT /api/admin/storage. They are stored encrypted in D1.')
  console.log('===================================================================')
  console.log('')

  if (nonInteractive) {
    console.log(
      'Non-interactive mode: missing values that cannot be auto-generated will fail fast.',
    )
  }

  const existing = new Set(listSecrets())
  console.log(`Found ${existing.size} existing secret(s).`)

  let setCount = 0
  let skippedCount = 0

  for (const spec of secretsSpec) {
    if (existing.has(spec.name)) {
      if (skipExisting) {
        console.log(`Skipping ${spec.name} (already set, --skip-existing)`)
        skippedCount++
        continue
      }
      if (nonInteractive && !force) {
        console.log(
          `Skipping ${spec.name} (already set; pass --force to overwrite in non-interactive mode)`,
        )
        skippedCount++
        continue
      }
      if (!nonInteractive && !force) {
        const overwrite = await ask(`${spec.name} already set. Overwrite? (y/N): `)
        if (overwrite.toLowerCase() !== 'y') {
          console.log(`Skipping ${spec.name}`)
          skippedCount++
          continue
        }
      } else {
        console.log(`Overwriting ${spec.name} (--force)`)
      }
    }

    const value = await resolveValue(spec)
    run(
      `wrangler secret put ${spec.name} --config wrangler.production.jsonc`,
      value,
    )
    console.log(`Set ${spec.name}`)
    setCount++
  }

  console.log(`\nDone. Set ${setCount} secret(s), skipped ${skippedCount}.`)
  console.log('Migrations are applied automatically by `setup:production`.')
  console.log('\nNext: deploy:')
  console.log('  pnpm run deploy')
  console.log(
    '\nReminder: after deploying, register a user at POST /api/auth/register to get a session cookie,',
  )
  console.log('then sign in as that user and (as admin) open Storage Settings to configure the backend.')
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  if (nonInteractive) {
    console.error(
      'Hint: in non-interactive mode every required value must be set via env vars or auto-generated.',
    )
  }
  process.exit(1)
})
