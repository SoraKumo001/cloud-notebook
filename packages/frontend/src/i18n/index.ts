/**
 * i18next initialization.
 *
 * Phase 0 scaffold: registers the `en` and `ja` namespaces, persists the
 * user's manual selection in localStorage, and falls back to
 * `navigator.language` for first-time visitors. The `<html lang>` attribute
 * is kept in sync by `I18nProvider`.
 *
 * Phase 1+ will populate the `common` namespace with the actual UI strings
 * extracted from the components.
 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common.json'
import jaCommon from './locales/ja/common.json'

export const SUPPORTED_LOCALES = ['en', 'ja'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'en'
export const LOCALE_STORAGE_KEY = 'cloud-notebook.locale'

/**
 * Pick a supported locale from a free-form language tag.
 * e.g. "ja-JP" -> "ja", "en-US" -> "en", "fr-FR" -> "en" (fallback).
 */
export function resolveSupportedLocale(input: string | null | undefined): SupportedLocale {
  if (!input) return DEFAULT_LOCALE
  const lower = input.toLowerCase()
  for (const tag of SUPPORTED_LOCALES) {
    if (lower === tag || lower.startsWith(`${tag}-`)) return tag
  }
  return DEFAULT_LOCALE
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon },
      ja: { common: jaCommon },
    },
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    ns: ['common'],
    defaultNS: 'common',
    load: 'currentOnly',
    debug: false,
    interpolation: {
      // Catalog strings use single-brace placeholders (e.g. "{count}") which
      // match the convention used by hand-written translations and ICU plural
      // strings in this project. Override the i18next default ("{{" / "}}").
      prefix: '{',
      suffix: '}',
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      convertDetectedLanguage: resolveSupportedLocale,
    },
    react: {
      useSuspense: false,
    },
  })

export default i18n
