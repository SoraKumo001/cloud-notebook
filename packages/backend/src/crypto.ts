// packages/backend/src/crypto.ts
// AES-256-GCM encryption/decryption for notebooks.ai_api_key
//
// Design:
//   Master key:     32-byte (256-bit) base64-encoded, stored in Wrangler Secret
//                   (API_KEY_ENCRYPTION_MASTER).  Must be set or startup fails.
//   Algorithm:      AES-GCM 256-bit, 96-bit (12-byte) random IV, 128-bit auth tag
//   Storage format: "{iv_b64}:{ciphertext_b64}:{tag_b64}"
//                   Future v2: "{key_version}:{iv_b64}:{ciphertext_b64}:{tag_b64}"
//   Runtime:        Web Crypto API (crypto.subtle) — native in Workers + Node 19+
//   Key rotation:   Not implemented yet; single master key for v1.
//   Plaintext fallback: decryptApiKey rejects non-encrypted (plaintext) values
//                       with a format error — callers should catch and treat as
//                       legacy plaintext if needed.

const AES_GCM_IV_LENGTH = 12 // 96 bits
const AES_GCM_TAG_LENGTH = 128 // bits
const AES_KEY_LENGTH = 32 // 256 bits

// ---- internal helpers -------------------------------------------------------

function decodeKeyBytes(b64: string): ArrayBuffer {
  // atob operates on Latin-1; for raw bytes this is a lossless round-trip
  // because every byte 0x00–0xFF maps to a valid character.
  try {
    const bin = atob(b64)
    if (bin.length !== AES_KEY_LENGTH) {
      throw new Error(`Invalid key length: expected ${AES_KEY_LENGTH} bytes, got ${bin.length}`)
    }
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return buf.buffer
  } catch (e) {
    // DOMException is thrown by atob in both Workers and Node for invalid input
    if (e instanceof DOMException) {
      throw new Error('Invalid master key: not a valid base64 string')
    }
    // Re-throw our own structured errors (e.g. length check above)
    if (e instanceof Error && e.message.startsWith('Invalid key')) {
      throw e
    }
    throw new Error('Invalid master key: not a valid base64 string')
  }
}

async function importAesKey(raw: ArrayBuffer): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      false, // not extractable
      ['encrypt', 'decrypt'],
    )
  } catch (e) {
    throw new Error(`Failed to import AES key: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH))
}

function base64Encode(bytes: Uint8Array): string {
  // String.fromCharCode.apply handles each byte as Latin-1 char.
  // For the payload sizes we deal with (keys, IVs, small API keys) this is safe.
  return btoa(String.fromCharCode(...bytes))
}

function base64Decode(b64: string, label: string): Uint8Array {
  try {
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return buf
  } catch {
    throw new Error(`Invalid encrypted data: ${label} is not valid base64`)
  }
}

// ---- public API -------------------------------------------------------------

/**
 * Decrypt a stored API key using the master key from env.
 * Returns `null` when the stored value is null/empty (no key configured).
 */
export async function getDecryptedApiKey(
  masterKey: string | undefined,
  encryptedApiKey: string | null | undefined,
): Promise<string | null> {
  if (!encryptedApiKey) return null
  if (!masterKey) throw new Error('API_KEY_ENCRYPTION_MASTER is not set')
  return decryptApiKey(masterKey, encryptedApiKey)
}

/**
 * Encrypt a plaintext string under the 256-bit master key.
 *
 * @param masterKeyB64  32-byte base64-encoded AES key (from env secret)
 * @param plaintext     The sensitive value to protect (e.g. API key)
 * @returns             Storage-format string: `"{iv}:{ciphertext}:{tag}"`
 *                      each component is base64-encoded.
 */
export async function encryptApiKey(masterKeyB64: string, plaintext: string): Promise<string> {
  const rawKey = decodeKeyBytes(masterKeyB64)
  const key = await importAesKey(rawKey)
  const iv = randomIv()
  const encoded = new TextEncoder().encode(plaintext)

  // crypto.subtle.encrypt with AES-GCM returns ciphertext || tag
  const combined = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: AES_GCM_TAG_LENGTH },
    key,
    encoded,
  )

  const combinedBytes = new Uint8Array(combined)
  const tagLen = AES_GCM_TAG_LENGTH / 8 // 16
  const ct = combinedBytes.slice(0, combinedBytes.length - tagLen)
  const tag = combinedBytes.slice(combinedBytes.length - tagLen)

  return [iv, ct, tag].map(base64Encode).join(':')
}

/**
 * Decrypt a value previously produced by {@link encryptApiKey}.
 *
 * @param masterKeyB64   32-byte base64-encoded AES key (same as encryption)
 * @param encryptedData  Storage-format string from {@link encryptApiKey}
 * @returns              Original plaintext
 *
 * @throws On tampered ciphertext (auth-tag mismatch), wrong key, or invalid
 *         format.  Callers should catch and treat as corrupted / legacy data.
 */
export async function decryptApiKey(masterKeyB64: string, encryptedData: string): Promise<string> {
  const parts = encryptedData.split(':')
  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted data format: expected 3 colon-separated parts, got ${parts.length}`,
    )
  }

  const [ivB64, ctB64, tagB64] = parts as [string, string, string]
  const iv = base64Decode(ivB64, 'IV')
  const ct = base64Decode(ctB64, 'ciphertext')
  const tag = base64Decode(tagB64, 'tag')

  if (iv.length !== AES_GCM_IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${AES_GCM_IV_LENGTH} bytes, got ${iv.length}`)
  }

  // Recombine ciphertext + tag into single buffer for Web Crypto
  const combined = new Uint8Array(ct.length + tag.length)
  combined.set(ct, 0)
  combined.set(tag, ct.length)

  const rawKey = decodeKeyBytes(masterKeyB64)
  const key = await importAesKey(rawKey)

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: AES_GCM_TAG_LENGTH },
      key,
      combined,
    )
    return new TextDecoder().decode(decrypted)
  } catch (e) {
    throw new Error(
      `Decryption failed (wrong key or tampered data): ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }
}

// ---- token hashing (deterministic lookup) -----------------------------------

/**
 * Hash a bearer token with SHA-256 for safe storage and SQL `eq()` lookup.
 *
 * Unlike `encryptApiKey` (AES-GCM with a random IV, non-deterministic), this
 * produces a stable digest so the auth middleware can hash the incoming
 * Bearer token and find the matching row via an indexed equality scan.
 *
 * Used for `notebooks.mcp_token`. The token itself is a 256-bit
 * server-generated random secret; we store only its SHA-256 digest so a DB
 * dump does not reveal usable tokens. No master key is required.
 *
 * @param token  Plaintext bearer token.
 * @returns       Lowercase hex SHA-256 digest (64 chars).
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
