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
