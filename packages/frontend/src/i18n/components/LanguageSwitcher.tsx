/**
 * LanguageSwitcher — compact dropdown for the active UI language.
 *
 * Phase 0 scaffold. Visual polish (placement, icon, motion) is deferred to
 * Phase 1 when the header layout is finalised.
 */
import { Check, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, type SupportedLocale, useLocale } from '../useLocale'

const LOCALE_LABEL: Record<SupportedLocale, string> = {
  en: 'English',
  ja: '日本語',
}

const LOCALE_CATALOG_KEY: Record<SupportedLocale, string> = {
  en: 'language.english',
  ja: 'language.japanese',
}

export function LanguageSwitcher() {
  const { t } = useTranslation('common')
  const { locale, setLocale } = useLocale()

  return (
    <div className='dropdown dropdown-end'>
      <button
        type='button'
        className='btn btn-ghost btn-sm gap-2 px-2'
        aria-label={t('language.switchLabel')}
        title={t('language.switchLabel')}
      >
        <Globe size={16} strokeWidth={2} aria-hidden='true' />
        <span className='hidden sm:inline'>{LOCALE_LABEL[locale]}</span>
        <span className='sm:hidden'>{locale.toUpperCase()}</span>
      </button>
      <ul
        // daisyui v5 dropdowns require tabIndex on the menu container for
        // focus-based show/hide behaviour; see https://daisyui.com/components/dropdown/
        // biome-ignore lint/a11y/noNoninteractiveTabindex: daisyui dropdown requirement
        tabIndex={0}
        className='menu menu-sm dropdown-content z-10 mt-2 w-44 rounded-box bg-base-100 p-2 shadow'
      >
        {SUPPORTED_LOCALES.map((code) => {
          const isActive = code === locale
          return (
            <li key={code}>
              <button
                type='button'
                className={`justify-between ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  void setLocale(code)
                }}
              >
                <span>{t(LOCALE_CATALOG_KEY[code])}</span>
                {isActive && (
                  <Check size={16} strokeWidth={2} className='text-accent' aria-hidden='true' />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
