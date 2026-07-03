// Enable React 19 act() support under happy-dom (suppresses the "current testing
// environment is not configured to support act(...)" warning).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './i18n/locales/en/common.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
  },
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  lng: 'en',
  interpolation: {
    escapeValue: false,
  },
})
