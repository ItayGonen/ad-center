import { useTranslation } from 'react-i18next';

export default function MediaGuidelines() {
  const { t } = useTranslation('orders');

  return (
    <div className="media-guidelines">
      {/* Card 1 — Screen Format */}
      <div className="media-guide-card">
        <div className="media-guide-card-header">
          <svg className="media-guide-card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <line x1="12" y1="18" x2="12" y2="18.01" />
          </svg>
          <span className="media-guide-card-title">{t('guideScreenFormat')}</span>
        </div>
        <div className="media-guide-card-body">
          {t('guideVertical')}: <strong>1080 × 1920 px</strong><br />
          {t('guideHorizontal')}: <strong>1920 × 1080 px</strong><br />
          {t('guideSupportedFormats')}: <strong>MP4 / JPG / PNG</strong>
        </div>
      </div>

      {/* Card 2 — Video Length */}
      <div className="media-guide-card">
        <div className="media-guide-card-header">
          <svg className="media-guide-card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="media-guide-card-title">{t('guideVideoLength')}</span>
        </div>
        <div className="media-guide-card-body">
          {t('guideVideoLengthDesc')}<br />
          • {t('guideRecommended')}<br />
          • {t('guideAlternative')}
        </div>
      </div>

      {/* Card 3 — Design Tip */}
      <div className="media-guide-card">
        <div className="media-guide-card-header">
          <svg className="media-guide-card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2z" />
          </svg>
          <span className="media-guide-card-title">{t('guideDesignTip')}</span>
        </div>
        <div className="media-guide-card-body">
          {t('guideDesignTipDesc')}
        </div>
      </div>
    </div>
  );
}
