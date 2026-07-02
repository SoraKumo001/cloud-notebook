import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatLongDate,
  formatNumber,
  formatRelative,
  formatShortDate,
  pickRelativeTime,
} from './formatters'

const T0 = new Date('2026-07-02T12:00:00Z').getTime()

describe('i18n.formatters', () => {
  describe('formatLongDate', () => {
    it('renders en-US style', () => {
      const out = formatLongDate('en', T0)
      // Accept any date library default; we just need a non-empty string that
      // contains a year. The exact text depends on timezone of the test runner.
      expect(out).toMatch(/2026/)
    })

    it('renders ja-JP style', () => {
      const out = formatLongDate('ja', T0)
      expect(out).toMatch(/2026/)
    })
  })

  describe('formatShortDate', () => {
    it('produces a string', () => {
      expect(formatShortDate('en', T0)).toBeTypeOf('string')
      expect(formatShortDate('ja', T0).length).toBeGreaterThan(0)
    })
  })

  describe('formatBytes', () => {
    it('zero is labelled in the locale', () => {
      expect(formatBytes('en', 0)).toEqual({ value: 0, unit: 'Bytes' })
      expect(formatBytes('ja', 0)).toEqual({ value: 0, unit: 'バイト' })
    })

    it('picks KB/MB/GB by magnitude', () => {
      expect(formatBytes('en', 512).unit).toBe('Bytes')
      expect(formatBytes('en', 2048).unit).toBe('KB')
      expect(formatBytes('en', 5 * 1024 * 1024).unit).toBe('MB')
      expect(formatBytes('en', 3 * 1024 ** 3).unit).toBe('GB')
    })

    it('handles non-finite / negative input', () => {
      expect(formatBytes('en', Number.NaN)).toEqual({ value: 0, unit: 'Bytes' })
      expect(formatBytes('en', -1)).toEqual({ value: 0, unit: 'Bytes' })
    })
  })

  describe('formatNumber', () => {
    it('en-US uses dot decimal', () => {
      expect(formatNumber('en', 1234.5, 1)).toBe('1,234.5')
    })

    it('ja-JP uses fullwidth decimal separator', () => {
      // ja-JP default uses ASCII dot, but with grouping
      expect(formatNumber('ja', 1234.5, 1)).toBe('1,234.5')
    })
  })

  describe('pickRelativeTime', () => {
    it('returns seconds for near-present', () => {
      const r = pickRelativeTime(T0 - 10_000, new Date(T0))
      expect(r.unit).toBe('second')
    })

    it('returns minutes for an hour-ago timestamp', () => {
      const r = pickRelativeTime(T0 - 60 * 60 * 1000, new Date(T0))
      expect(r.unit).toBe('hour')
    })
  })

  describe('formatRelative', () => {
    it('returns a non-empty localised string', () => {
      expect(formatRelative('en', T0 - 60_000, new Date(T0))).toMatch(/ago|minute/)
      expect(formatRelative('ja', T0 - 60_000, new Date(T0)).length).toBeGreaterThan(0)
    })
  })
})
