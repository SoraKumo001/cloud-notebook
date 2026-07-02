// packages/backend/src/crypto.test.ts
// Unit tests for AES-256-GCM encryption/decryption utilities.
// Runs under Node 19+ (native crypto.subtle global).

import { describe, expect, it } from 'vitest'
import { decryptApiKey, encryptApiKey } from './crypto'

// ---- helpers ----------------------------------------------------------------

function validKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

// ---- encryptApiKey ----------------------------------------------------------

describe('encryptApiKey', () => {
  it('returns colon-separated base64 components', async () => {
    const key = validKey()
    const out = await encryptApiKey(key, 'sk-test-abc')
    const parts = out.split(':')
    expect(parts).toHaveLength(3)
    // each part decodes as base64 without error
    for (const p of parts) expect(() => atob(p)).not.toThrow()
  })

  it('produces different ciphertexts for identical plaintext (unique IV)', async () => {
    const key = validKey()
    const e1 = await encryptApiKey(key, 'same')
    const e2 = await encryptApiKey(key, 'same')
    expect(e1).not.toBe(e2)
  })

  it('handles empty string', async () => {
    const key = validKey()
    const out = await encryptApiKey(key, '')
    expect(out.split(':')).toHaveLength(3)
  })

  it('throws on non-base64 master key', async () => {
    await expect(encryptApiKey('!!!invalid-base64', 'x')).rejects.toThrow(/base64/i)
  })

  it('throws on wrong-length master key', async () => {
    const short = btoa('short') // 5 bytes
    await expect(encryptApiKey(short, 'x')).rejects.toThrow(/length/i)
  })

  it('throws on over-length master key', async () => {
    const long = btoa('x'.repeat(33)) // 33 bytes
    await expect(encryptApiKey(long, 'x')).rejects.toThrow(/length/i)
  })
})

// ---- decryptApiKey ----------------------------------------------------------

describe('decryptApiKey', () => {
  it('round-trips: encrypt → decrypt matches original', async () => {
    const key = validKey()
    const plaintext = 'sk-proj-abcdefghijklmnop'
    const enc = await encryptApiKey(key, plaintext)
    expect(await decryptApiKey(key, enc)).toBe(plaintext)
  })

  it('round-trips empty string', async () => {
    const key = validKey()
    const enc = await encryptApiKey(key, '')
    expect(await decryptApiKey(key, enc)).toBe('')
  })

  it('round-trips Unicode / emoji', async () => {
    const key = validKey()
    const plaintext = 'キー 🔑 Test 测试 🚀'
    const enc = await encryptApiKey(key, plaintext)
    expect(await decryptApiKey(key, enc)).toBe(plaintext)
  })

  it('rejects tampered ciphertext (auth-tag mismatch)', async () => {
    const key = validKey()
    const enc = await encryptApiKey(key, 'sensitive')
    const parts = enc.split(':')
    // Decode ciphertext, flip a byte, re-encode → valid base64, wrong value.
    const ctBytes = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0))
    if (ctBytes.length > 0) ctBytes[0] ^= 0x01
    parts[1] = btoa(String.fromCharCode(...ctBytes))
    await expect(decryptApiKey(key, parts.join(':'))).rejects.toThrow(/Decryption failed/i)
  })

  it('rejects tampered tag', async () => {
    const key = validKey()
    const enc = await encryptApiKey(key, 'sensitive')
    const parts = enc.split(':')
    // Decode the tag, flip a byte, re-encode → guaranteed valid base64,
    // guaranteed different tag → auth-tag mismatch.
    const tagBytes = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0))
    tagBytes[0] ^= 0x01 // flip bit 0
    parts[2] = btoa(String.fromCharCode(...tagBytes))
    await expect(decryptApiKey(key, parts.join(':'))).rejects.toThrow(/Decryption failed/i)
  })

  it('rejects wrong master key', async () => {
    const k1 = validKey()
    const k2 = validKey()
    const enc = await encryptApiKey(k1, 'data')
    await expect(decryptApiKey(k2, enc)).rejects.toThrow(/Decryption failed/)
  })

  it('rejects wrong number of colon-separated parts', async () => {
    const key = validKey()
    await expect(decryptApiKey(key, 'only-two:parts')).rejects.toThrow(/format/i)
    await expect(decryptApiKey(key, 'singlepart')).rejects.toThrow(/format/i)
    await expect(decryptApiKey(key, 'a:b:c:d')).rejects.toThrow(/format/i)
  })

  it('rejects non-base64 components', async () => {
    const key = validKey()
    await expect(decryptApiKey(key, '!!!:!!!:!!!')).rejects.toThrow(/base64/i)
  })

  it('rejects wrong IV length', async () => {
    // construct manually with a truncated IV
    const key = validKey()
    const valid = await encryptApiKey(key, 'data')
    const parts = valid.split(':')
    // shorten IV to 8 bytes
    const shortIv = btoa('12345678') // 8 bytes
    await expect(decryptApiKey(key, [shortIv, parts[1], parts[2]].join(':'))).rejects.toThrow(
      /IV length/i,
    )
  })
})

// ---- integration / stress ---------------------------------------------------

describe('integration', () => {
  it('handles long API key (1024 chars)', async () => {
    const key = validKey()
    const plaintext = `sk-${'x'.repeat(1020)}`
    const enc = await encryptApiKey(key, plaintext)
    expect(await decryptApiKey(key, enc)).toBe(plaintext)
  })

  it('multiple concurrent encryptions do not interfere', async () => {
    const key = validKey()
    const inputs = Array.from({ length: 10 }, (_, i) => `key-${i}-${'x'.repeat(50)}`)
    const encrypted = await Promise.all(inputs.map((p) => encryptApiKey(key, p)))
    const decrypted = await Promise.all(encrypted.map((c) => decryptApiKey(key, c)))
    expect(decrypted).toEqual(inputs)
  })

  it('works across 100 sequential round-trips (no state leak)', async () => {
    const key = validKey()
    for (let i = 0; i < 100; i++) {
      const p = `round-${i}`
      expect(await decryptApiKey(key, await encryptApiKey(key, p))).toBe(p)
    }
  })
})
