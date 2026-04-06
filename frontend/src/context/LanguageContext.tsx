import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import i18n from '../i18n';

interface LanguageContextType {
  language: string;
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
  setLanguage: (lang: string) => void;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  direction: 'ltr',
  isRTL: false,
  setLanguage: () => {},
});

const LANG_DIRECTIONS: Record<string, 'ltr' | 'rtl'> = {
  en: 'ltr',
  he: 'rtl',
};

function applyDirection(lang: string) {
  const dir = LANG_DIRECTIONS[lang] || 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
  return dir;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState(() => {
    return localStorage.getItem('language') || 'en';
  });

  const direction = LANG_DIRECTIONS[language] || 'ltr';
  const isRTL = direction === 'rtl';

  // Apply direction on mount and language change
  useEffect(() => {
    applyDirection(language);
  }, [language]);

  const setLanguage = useCallback((lang: string) => {
    localStorage.setItem('language', lang);
    i18n.changeLanguage(lang);
    setLanguageState(lang);
    applyDirection(lang);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, direction, isRTL, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
