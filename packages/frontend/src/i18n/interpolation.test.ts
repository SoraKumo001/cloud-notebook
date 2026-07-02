/**
 * Interpolation regression tests.
 *
 * The catalog uses single-brace placeholders (e.g. "{count}") throughout,
 * and the i18next config in `./index.ts` overrides the default
 * "{{" / "}}" prefix/suffix to match. These tests guard that contract so
 * future config changes don't silently regress to literal-placeholder UI.
 */
import { describe, expect, it } from 'vitest'
import i18n from './index'

describe('i18n.interpolation', () => {
  it('interpolates single-brace placeholders in ja catalog', () => {
    i18n.changeLanguage('ja')
    const got = i18n.t('chat.conversations', { count: 3 })
    expect(got).toBe('会話 (3)')
    expect(got).not.toContain('{count}')
  })

  it('interpolates single-brace placeholders in en catalog', () => {
    i18n.changeLanguage('en')
    const got = i18n.t('chat.conversations', { count: 3 })
    expect(got).toBe('Conversations (3)')
    expect(got).not.toContain('{count}')
  })

  it('interpolates multiple placeholders in sourceList.stats (ja)', () => {
    i18n.changeLanguage('ja')
    const got = i18n.t('sourceList.stats', {
      count: 5,
      vectors: 120,
      globalVectors: 4800,
    })
    expect(got).toBe('合計 5 · 120 ベクトル(全体: 4800)')
    expect(got).not.toMatch(/\{(count|vectors|globalVectors)\}/)
  })

  it('interpolates multiple placeholders in sourceList.stats (en)', () => {
    i18n.changeLanguage('en')
    const got = i18n.t('sourceList.stats', {
      count: 5,
      vectors: 120,
      globalVectors: 4800,
    })
    expect(got).toBe('5 total · 120 vectors (Global: 4800)')
    expect(got).not.toMatch(/\{(count|vectors|globalVectors)\}/)
  })

  it('renders notebookCard source count as plain text (en, plural=1)', () => {
    i18n.changeLanguage('en')
    const got = i18n.t('notebookCard.sourceCountOne', { count: 1 })
    expect(got).toBe('1 source')
    expect(got).not.toMatch(/[{}]/)
  })

  it('renders notebookCard source count as plain text (en, plural=other)', () => {
    i18n.changeLanguage('en')
    const got = i18n.t('notebookCard.sourceCountOther', { count: 4 })
    expect(got).toBe('4 sources')
    expect(got).not.toMatch(/[{}]/)
  })

  it('renders notebookCard source count as plain text (ja)', () => {
    i18n.changeLanguage('ja')
    const got = i18n.t('notebookCard.sourceCountOther', { count: 4 })
    expect(got).toBe('ソース 4件')
    expect(got).not.toMatch(/[{}]/)
  })
})
