import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { sendBroadcastNotification } from '../services/admin';
import Loader from '../components/Loader';

const NOTIFICATION_TYPES = ['info', 'warning', 'promotion', 'system_update'];

const TYPE_COLORS: Record<string, string> = {
  info: '#2563eb',
  warning: '#d97706',
  promotion: '#7c3aed',
  system_update: '#64748b',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  ),
  warning: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  ),
  promotion: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5" rx="1"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>
  ),
  system_update: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
  ),
};

export default function AdminNotifications() {
  const { t } = useTranslation('admin');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [notifType, setNotifType] = useState('info');
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const TYPE_LABELS: Record<string, string> = {
    info: t('typeInfo'),
    warning: t('typeWarning'),
    promotion: t('typePromotion'),
    system_update: t('typeSystemUpdate'),
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setConfirmOpen(true);
  }

  async function handleConfirmSend() {
    setConfirmOpen(false);
    setSending(true);
    setResult(null);
    try {
      const res = await sendBroadcastNotification({
        title,
        message,
        notification_type: notifType,
      });
      setResult({ type: 'success', text: t('sentToUsers', { count: res.sent }) });
      setTitle('');
      setMessage('');
      setNotifType('info');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setResult({ type: 'error', text: detail || t('failedSendNotif') });
    } finally {
      setSending(false);
    }
  }

  const selectedTypeLabel = TYPE_LABELS[notifType] || notifType;
  const typeColor = TYPE_COLORS[notifType] || '#64748b';
  const canSubmit = title.trim().length > 0 && message.trim().length > 0;

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <Link to="/admin/users" className="admin-tab">{t('users')}</Link>
        <Link to="/admin/spaces" className="admin-tab">{t('spaces')}</Link>
        <Link to="/admin/orders" className="admin-tab">{t('orders')}</Link>
        <Link to="/admin/calendar" className="admin-tab">{t('calendar')}</Link>
        <Link to="/admin/notifications" className="admin-tab active">{t('notifications')}</Link>
        <Link to="/admin/translations" className="admin-tab">{t('translations')}</Link>
        <Link to="/admin/settings" className="admin-tab">{t('settings')}</Link>
      </div>

      <h1>{t('sendNotification')}</h1>
      <p className="admin-broadcast-desc">{t('sendNotifDesc')}</p>

      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="admin-form-section">
          <div className="admin-form-section-title">{t('notifDetails')}</div>

          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label>{t('title')} <span className="admin-required">*</span></label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                maxLength={100}
                required
              />
            </div>
            <div>
              <label>{t('notifType')}</label>
              <div className="notif-type-grid">
                {NOTIFICATION_TYPES.map(typeVal => (
                  <button
                    key={typeVal}
                    type="button"
                    className={`notif-type-btn ${notifType === typeVal ? 'notif-type-btn-active' : ''}`}
                    style={{
                      '--notif-color': TYPE_COLORS[typeVal],
                    } as React.CSSProperties}
                    onClick={() => setNotifType(typeVal)}
                  >
                    <span className="notif-type-btn-icon" style={{ color: TYPE_COLORS[typeVal] }}>{TYPE_ICONS[typeVal]}</span>
                    <span className="notif-type-btn-label">{TYPE_LABELS[typeVal]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#333' }}>
              {t('message')} <span className="admin-required">*</span>
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={t('messagePlaceholder')}
              rows={4}
              maxLength={500}
              required
            />
            <span className="admin-form-hint">{t('charsCount', { count: message.length, max: 500 })}</span>
          </div>
        </div>

        {/* Preview */}
        <div className="admin-form-section" style={{ marginTop: 20 }}>
          <div className="admin-form-section-title">{t('preview')}</div>
          <div className="admin-broadcast-preview" style={{ borderLeftColor: typeColor }}>
            <span className="notif-type-badge" style={{ background: `${typeColor}14`, color: typeColor, border: `1px solid ${typeColor}30` }}>
              <span className="notif-type-badge-icon">{TYPE_ICONS[notifType]}</span>
              {selectedTypeLabel}
            </span>
            <div className="admin-broadcast-preview-body">
              <span className="admin-broadcast-preview-title">
                {title || t('titlePlaceholder')}
              </span>
              <span className="admin-broadcast-preview-msg">{message || t('messagePlaceholder')}</span>
            </div>
          </div>
        </div>

        {result && <div className={`admin-broadcast-result ${result.type}`}>{result.text}</div>}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={!canSubmit || sending}>
            {sending ? (
              <>
                <Loader variant="button" className="loader-light" />
                {t('sending')}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                {t('sendToAll')}
              </>
            )}
          </button>
        </div>
      </form>

      {/* Confirmation modal */}
      {confirmOpen && (
        <div className="admin-broadcast-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="admin-broadcast-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('confirmSend')}</h3>
            <p>{t('confirmSendDesc')}</p>
            <div className="admin-broadcast-modal-preview" style={{ borderLeftColor: typeColor }}>
              <span className="notif-type-badge" style={{ background: `${typeColor}14`, color: typeColor, border: `1px solid ${typeColor}30` }}>
                <span className="notif-type-badge-icon">{TYPE_ICONS[notifType]}</span>
                {selectedTypeLabel}
              </span>
              <strong>{title}</strong>
              <span>{message}</span>
            </div>
            <div className="admin-broadcast-modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmOpen(false)}>{t('cancel', { ns: 'common' })}</button>
              <button className="btn-primary" onClick={handleConfirmSend}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                {t('confirmAndSend')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
