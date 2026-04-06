import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import { API_URL } from './services/api';

// Fallback imports
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enSpaces from './locales/en/spaces.json';
import enOrders from './locales/en/orders.json';
import enSettings from './locales/en/settings.json';
import enAdmin from './locales/en/admin.json';
import heCommon from './locales/he/common.json';
import heAuth from './locales/he/auth.json';
import heSpaces from './locales/he/spaces.json';
import heOrders from './locales/he/orders.json';
import heSettings from './locales/he/settings.json';
import heAdmin from './locales/he/admin.json';
import enCreatives from './locales/en/creatives.json';
import heCreatives from './locales/he/creatives.json';

const savedLang = localStorage.getItem('language') || 'en';

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: savedLang,
    fallbackLng: 'en',
    ns: ['common', 'auth', 'admin', 'spaces', 'settings', 'orders', 'creatives'],
    defaultNS: 'common',
    backend: {
      loadPath: `${API_URL}/translations/ui/{{lng}}?namespace={{ns}}`,
    },
    partialBundledLanguages: true,
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        spaces: enSpaces,
        orders: enOrders,
        settings: enSettings,
        admin: enAdmin,
        creatives: enCreatives,
      },
      he: {
        common: heCommon,
        auth: heAuth,
        spaces: heSpaces,
        orders: heOrders,
        settings: heSettings,
        admin: heAdmin,
        creatives: heCreatives,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
