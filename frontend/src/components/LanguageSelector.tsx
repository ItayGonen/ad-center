interface LanguageSelectorProps {
  value: string;
  onChange: (lang: string) => void;
  layout?: 'horizontal' | 'vertical';
}

const LANGUAGES = [
  { code: 'en', flag: '\u{1F1FA}\u{1F1F8}', label: 'English' },
  { code: 'he', flag: '\u{1F1EE}\u{1F1F1}', label: '\u05E2\u05D1\u05E8\u05D9\u05EA' },
];

export default function LanguageSelector({ value, onChange, layout = 'horizontal' }: LanguageSelectorProps) {
  return (
    <div className={`lang-selector ${layout === 'vertical' ? 'lang-selector-vertical' : ''}`}>
      {LANGUAGES.map(lang => (
        <button
          key={lang.code}
          type="button"
          className={`lang-option${value === lang.code ? ' selected' : ''}`}
          onClick={() => onChange(lang.code)}
        >
          <span className="lang-flag">{lang.flag}</span>
          <span className="lang-label">{lang.label}</span>
          {value === lang.code && (
            <span className="lang-check">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
