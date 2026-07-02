/**
 * Locale-aware formatters.
 *
 * Centralises all `Intl.*` usage so components and hooks don't have to
 * instantiate the same DateTime/Number/RelativeTime formatters repeatedly.
 * All formatters take a `locale` string and fall back gracefully when a
 * feature isn't supported by the runtime (we never throw).
 */
import type { SupportedLocale } from './index'

/**
 * Cache formatters by locale. Creating an `Intl.*` instance is cheap but
 * not free; reuse across renders.
 */
const dateCache = new Map<string, Intl.DateTimeFormat>()
const shortDateCache = new Map<string, Intl.DateTimeFormat>()
const dateTimeCache = new Map<string, Intl.DateTimeFormat>()
const numberCache = new Map<string, Intl.NumberFormat>()
const relativeCache = new Map<string, Intl.RelativeTimeFormat>()

function getOrCreate<K, V>(cache: Map<K, V>, key: K, factory: () => V): V {
  const existing = cache.get(key)
  if (existing) return existing
  const created = factory()
  cache.set(key, created)
  return created
}

/** "Mar 5, 2026" style — used in card / list headers. */
export function formatLongDate(locale: SupportedLocale, value: Date | string | number): string {
  const fmt = getOrCreate(
    dateCache,
    locale,
    () =>
      new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
  )
  return fmt.format(new Date(value))
}

/** "Mar 5" — used in session/note list rows. */
export function formatShortDate(locale: SupportedLocale, value: Date | string | number): string {
  const fmt = getOrCreate(
    shortDateCache,
    locale,
    () =>
      new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        month: 'short',
        day: 'numeric',
      }),
  )
  return fmt.format(new Date(value))
}

/** Locale-default date+time — used for invite issued/expires timestamps. */
export function formatDateTime(locale: SupportedLocale, value: Date | string | number): string {
  const fmt = getOrCreate(
    dateTimeCache,
    locale,
    () =>
      new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
  )
  return fmt.format(new Date(value))
}

const BYTE_UNITS_EN = ['Bytes', 'KB', 'MB', 'GB', 'TB'] as const
const BYTE_UNITS_JA = ['バイト', 'KB', 'MB', 'GB', 'TB'] as const

export interface FormatBytesResult {
  value: number
  unit: string
}

/**
 * Pick the best unit and return the numeric value + localised unit label.
 * Keeps numeric formatting consistent with the locale (thousands separator).
 */
export function formatBytes(
  locale: SupportedLocale,
  bytes: number,
  _fractionDigits = 1,
): FormatBytesResult {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return { value: 0, unit: locale === 'ja' ? 'バイト' : 'Bytes' }
  }
  if (bytes === 0) {
    return { value: 0, unit: locale === 'ja' ? 'バイト' : 'Bytes' }
  }
  const units = locale === 'ja' ? BYTE_UNITS_JA : BYTE_UNITS_EN
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return { value, unit: units[i] ?? units[0] }
}

/** Locale-aware decimal formatting. */
export function formatNumber(
  locale: SupportedLocale,
  value: number,
  maxFractionDigits = 1,
): string {
  const fmt = getOrCreate(
    numberCache,
    `${locale}:${maxFractionDigits}`,
    () =>
      new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        maximumFractionDigits: maxFractionDigits,
      }),
  )
  return fmt.format(value)
}

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 365 * 24 * 60 * 60 },
  { unit: 'month', seconds: 30 * 24 * 60 * 60 },
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
]

/**
 * Pick the best Intl.RelativeTimeFormat unit and return its value (rounded)
 * and the unit key. Callers can use the unit key with their own translation
 * table (e.g. `t('note.time.minutesAgo', { count })`) or render directly
 * via `formatRelative(locale, value, unitKey)`.
 */
export function pickRelativeTime(
  value: Date | string | number,
  now: Date = new Date(),
): {
  count: number
  unit: Intl.RelativeTimeFormatUnit
} {
  const diffSeconds = (new Date(value).getTime() - now.getTime()) / 1000
  const abs = Math.abs(diffSeconds)
  for (const candidate of RELATIVE_UNITS) {
    if (abs >= candidate.seconds || candidate.unit === 'second') {
      return { count: -Math.round(diffSeconds / candidate.seconds), unit: candidate.unit }
    }
  }
  return { count: 0, unit: 'second' }
}

/** Returns the auto-localised relative string ("5 min ago" / "5分前"). */
export function formatRelative(
  locale: SupportedLocale,
  value: Date | string | number,
  now?: Date,
): string {
  const fmt = getOrCreate(
    relativeCache,
    locale,
    () => new Intl.RelativeTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { numeric: 'auto' }),
  )
  const { count, unit } = pickRelativeTime(value, now)
  return fmt.format(count, unit)
}
