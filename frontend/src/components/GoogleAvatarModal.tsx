import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Loader from './Loader';

interface GoogleAvatarModalProps {
  pictureUrl: string;
  onConfirm: () => Promise<void>;
  onDismiss: () => void;
}

export default function GoogleAvatarModal({ pictureUrl, onConfirm, onDismiss }: GoogleAvatarModalProps) {
  const { t } = useTranslation('common');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-overlay" onClick={saving ? undefined : onDismiss}>
      <div className="app-modal-card" onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
        <h3 className="app-modal-title">{t('googleAvatarTitle')}</h3>
        <img
          src={pictureUrl}
          alt="Google avatar"
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            objectFit: 'cover',
            margin: '12px auto',
            display: 'block',
          }}
          referrerPolicy="no-referrer"
        />
        <p className="app-modal-message">{t('googleAvatarMessage')}</p>
        <div className="app-modal-buttons" style={{ justifyContent: 'center' }}>
          <button
            className="app-modal-btn app-modal-btn-secondary"
            onClick={onDismiss}
            disabled={saving}
          >
            {t('googleAvatarNo')}
          </button>
          <button
            className="app-modal-btn app-modal-btn-primary"
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? <Loader variant="button" className="loader-light" /> : t('googleAvatarYes')}
          </button>
        </div>
      </div>
    </div>
  );
}
