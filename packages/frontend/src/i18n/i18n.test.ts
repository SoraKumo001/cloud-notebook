import { describe, expect, it } from 'vitest'
import { resolveSupportedLocale, SUPPORTED_LOCALES } from './index'

describe('i18n.locale resolution', () => {
  it('returns en for unknown tags', () => {
    expect(resolveSupportedLocale('fr-FR')).toBe('en')
    expect(resolveSupportedLocale(null)).toBe('en')
    expect(resolveSupportedLocale(undefined)).toBe('en')
  })

  it('matches exact tags', () => {
    expect(resolveSupportedLocale('en')).toBe('en')
    expect(resolveSupportedLocale('ja')).toBe('ja')
  })

  it('matches region variants', () => {
    expect(resolveSupportedLocale('ja-JP')).toBe('ja')
    expect(resolveSupportedLocale('en-US')).toBe('en')
    expect(resolveSupportedLocale('EN-GB')).toBe('en')
  })

  it('exposes the supported locale list', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['en', 'ja'])
  })
})
