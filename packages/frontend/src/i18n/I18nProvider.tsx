/**
 * I18nProvider
 *
 * Wraps the app with react-i18next. Its main responsibilities:
 *   1. Side-effect import of the i18next module (runs `i18n.init()`).
 *   2. Keep `<html lang>` in sync with the active i18next language.
 *   3. Expose `useLocale()` for components that need to read or change it.
 *
 * Keep this component dumb: it does NOT fetch locale lists, show a switcher,
 * or persist anything beyond what LanguageDetector already does.
 */
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import i18n, { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from './index'
import { useLocale } from './useLocale'

export type { SupportedLocale }
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, useLocale }

interface I18nProviderProps {
  children: ReactNode
}

function HtmlLangSync() {
  const { i18n: i18nInstance } = useTranslation()
  useEffect(() => {
    const lng = i18nInstance.language || DEFAULT_LOCALE
    document.documentElement.lang = lng
  }, [i18nInstance.language])
  return null
}

export function I18nProvider({ children }: I18nProviderProps) {
  return (
    <I18nextProvider i18n={i18n} defaultNS='common'>
      <HtmlLangSync />
      {children}
    </I18nextProvider>
  )
}
