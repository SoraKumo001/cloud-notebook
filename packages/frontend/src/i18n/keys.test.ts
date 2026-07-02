/**
 * Snapshot the dot-path keys present in each locale file and assert that
 * the en/ja catalogs are in lock-step. This prevents the common i18n drift
 * where a key is added in en but forgotten in ja.
 */
import { describe, expect, it } from 'vitest'
import enCatalog from './locales/en/common.json'
import jaCatalog from './locales/ja/common.json'

type JsonObject = Record<string, JsonValue>
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

function flatten(obj: JsonValue, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? [prefix] : []
  }
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as JsonObject)) {
    const next = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, next))
    } else {
      out.push(next)
    }
  }
  return out
}

describe('i18n locale parity', () => {
  const enKeys = new Set(flatten(enCatalog))
  const jaKeys = new Set(flatten(jaCatalog))

  it('en and ja share the same key set', () => {
    const missingInJa = [...enKeys].filter((k) => !jaKeys.has(k))
    const missingInEn = [...jaKeys].filter((k) => !enKeys.has(k))
    expect(missingInJa).toEqual([])
    expect(missingInEn).toEqual([])
  })

  it('en catalog has at least 80 keys (covers Phase 1 surface)', () => {
    expect(enKeys.size).toBeGreaterThanOrEqual(80)
  })
})
