/**
 * useLocale — read the active i18next language and change it.
 *
 * Changing the locale via `setLocale()` also persists it to localStorage
 * (handled by LanguageDetector's `caches: ['localStorage']`).
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_LOCALE,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './index'

interface UseLocaleResult {
  locale: SupportedLocale
  setLocale: (next: SupportedLocale) => Promise<void>
  supportedLocales: readonly SupportedLocale[]
}

export function useLocale(): UseLocaleResult {
  const { i18n: i18nInstance } = useTranslation()
  const locale = resolveSupportedLocale(i18nInstance.language) as SupportedLocale

  const setLocale = useCallback(
    async (next: SupportedLocale) => {
      await i18nInstance.changeLanguage(next)
    },
    [i18nInstance],
  )

  return {
    locale,
    setLocale,
    supportedLocales: SUPPORTED_LOCALES,
  }
}

export type { SupportedLocale }
export { DEFAULT_LOCALE, resolveSupportedLocale, SUPPORTED_LOCALES }
