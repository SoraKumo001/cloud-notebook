// packages/backend/src/password.ts
// PBKDF2-SHA256 password hashing using the Web Crypto API (Workers-native).
//
// Format: "{iterations}:{salt_b64}:{hash_b64}"
// - iterations: integer (PBKDF2_ITERATIONS, see below)
// - salt:       16 random bytes, base64-encoded
// - hash:       32 derived bits, base64-encoded
//
// Iteration count
// ---------------
// Cloudflare Workers' `crypto.subtle.deriveBits` for PBKDF2 caps the
// iteration count at 100,000 (the runtime throws
// `NotSupportedError: iteration counts above 100000 are not supported`).
// OWASP's 2023 recommendation for PBKDF2-SHA256 is 600,000, which is
// therefore unavailable here.
//
// 100,000 is the highest value the Workers runtime accepts, and at the
// same level of friction as Node's default scrypt for short passwords.
// To exceed this, switch to an Argon2id WASM implementation or a managed
// auth service (Clerk / Auth0 / WorkOS). The hash format keeps
// `iterations` as a leading field so a future migration can detect and
// rehash older entries.

const PBKDF2_ITERATIONS = 100_000
const SALT_LENGTH = 16 // bytes
const KEY_LENGTH = 32 // bytes
const ENCODER = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    KEY_LENGTH * 8,
  )
  return new Uint8Array(bits)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Hash a plaintext password using PBKDF2-SHA256.
 * Returns a self-describing string with iteration count for future upgrades.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('Password must not be empty')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS)
  return `${PBKDF2_ITERATIONS}:${bytesToBase64(salt)}:${bytesToBase64(hash)}`
}

/**
 * Verify a plaintext password against a stored hash.
 * Uses constant-time comparison to avoid timing leaks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3) return false
  const [iterStr, saltB64, hashB64] = parts as [string, string, string]
  const iterations = Number.parseInt(iterStr, 10)
  if (!Number.isFinite(iterations) || iterations < 1) return false

  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = base64ToBytes(saltB64)
    expected = base64ToBytes(hashB64)
  } catch {
    return false
  }

  const actual = await deriveBits(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}
