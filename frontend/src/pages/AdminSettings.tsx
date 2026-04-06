import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdminSettings, updateEmailSetting, updateAccentColor } from '../services/admin';
import Loader from '../components/Loader';

const DEFAULT_ACCENT = '#e61e4d';

export default function AdminSettings() {
  const { t } = useTranslation('admin');
  const [emailsEnabled, setEmailsEnabled] = useState(true);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingColor, setSavingColor] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then(data => {
        setEmailsEnabled(data.emails_enabled);
        if (data.accent_color) setAccentColor(data.accent_color);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle() {
    const next = !emailsEnabled;
    setSaving(true);
    try {
      await updateEmailSetting(next);
      setEmailsEnabled(next);
    } catch {
      // revert on failure
    } finally {
      setSaving(false);
    }
  }

  async function handleColorChange(color: string) {
    setAccentColor(color);
    document.documentElement.style.setProperty('--accent', color);
    setSavingColor(true);
    try {
      await updateAccentColor(color);
    } catch {
      // revert on failure
    } finally {
      setSavingColor(false);
    }
  }

  async function handleResetColor() {
    await handleColorChange(DEFAULT_ACCENT);
  }

  if (loading) return <Loader variant="page" />;

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <Link to="/admin/users" className="admin-tab">{t('users')}</Link>
        <Link to="/admin/spaces" className="admin-tab">{t('spaces')}</Link>
        <Link to="/admin/orders" className="admin-tab">{t('orders')}</Link>
        <Link to="/admin/calendar" className="admin-tab">{t('calendar')}</Link>
        <Link to="/admin/notifications" className="admin-tab">{t('notifications')}</Link>
        <Link to="/admin/translations" className="admin-tab">{t('translations')}</Link>
        <Link to="/admin/settings" className="admin-tab active">{t('settings')}</Link>
      </div>

      <h1>{t('settingsTitle')}</h1>

      {!emailsEnabled && (
        <div className="admin-settings-banner">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>{t('emailsDisabledWarning')}</span>
        </div>
      )}

      <div className="admin-settings-card">
        <div className="admin-settings-card-header">
          <div>
            <h3>{t('emailSending')}</h3>
            <p>{t('emailSendingDesc')}</p>
          </div>
          <button
            className={`admin-toggle ${emailsEnabled ? 'on' : ''}`}
            onClick={handleToggle}
            disabled={saving}
            aria-label={t('emailSending')}
          >
            <span className="admin-toggle-thumb" />
          </button>
        </div>
      </div>

      <div className="admin-settings-card">
        <div className="admin-settings-card-header">
          <div>
            <h3>{t('accentColor')}</h3>
            <p>{t('accentColorDesc')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0 8px' }}>
          <input
            type="color"
            value={accentColor}
            onChange={e => handleColorChange(e.target.value)}
            disabled={savingColor}
            style={{ width: 48, height: 48, border: 'none', cursor: 'pointer', borderRadius: 8, padding: 0 }}
          />
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              backgroundColor: accentColor,
              border: '2px solid #e0e0e0',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 14, color: '#666', fontFamily: 'monospace' }}>{accentColor}</span>
          {accentColor !== DEFAULT_ACCENT && (
            <button
              onClick={handleResetColor}
              disabled={savingColor}
              style={{
                marginInlineStart: 'auto',
                padding: '8px 16px',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid #ddd',
                background: '#fff',
                cursor: 'pointer',
                color: '#555',
              }}
            >
              {t('resetToDefault')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
