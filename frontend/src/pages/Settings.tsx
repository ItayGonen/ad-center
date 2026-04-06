import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  updateProfile,
  changePassword,
  uploadAvatar,
  deleteAvatar,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../services/auth';
import type { NotificationPreferences } from '../services/auth';
import LanguageSelector from '../components/LanguageSelector';
import { API_URL } from '../services/api';
import Loader from '../components/Loader';

/* ── SVG Icons ── */
const IconBack = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
);
const IconCreditCard = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
);
const IconBell = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
);
const IconSliders = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
);
const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
);
const IconEyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
);
const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
);

function getInitials(name?: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

type Section = 'account' | 'financial' | 'notifications' | 'preferences';

const DEFAULT_PREFS: NotificationPreferences = {
  email_notifications: true,
  notify_order_created: true,
  notify_order_confirmed: true,
  notify_order_cancelled: true,
  notify_order_completed: true,
};

export default function Settings() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { user, updateUser } = useAuth();
  const { language: currentLang, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('account');

  const sidebarSections = [
    {
      title: t('general'),
      items: [
        { id: 'account' as Section, label: t('account'), icon: <IconUser /> },
        { id: 'financial' as Section, label: t('financialPayments'), icon: <IconCreditCard /> },
      ],
    },
    {
      title: t('system'),
      items: [
        { id: 'notifications' as Section, label: t('notifications'), icon: <IconBell /> },
        { id: 'preferences' as Section, label: t('preferences'), icon: <IconSliders /> },
      ],
    },
  ];

  // Account form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      const nameParts = (user.name || '').split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
      setEmail(user.email || '');
      setPhone(user.phone_number || '');
      setCompany(user.company_name || '');
    }
  }, [user]);

  // Load notification preferences when that section becomes active
  useEffect(() => {
    if (activeSection === 'notifications') {
      setNotifLoading(true);
      getNotificationPreferences()
        .then(prefs => setNotifPrefs(prefs))
        .catch(() => {})
        .finally(() => setNotifLoading(false));
    }
  }, [activeSection]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const fullName = `${firstName} ${lastName}`.trim();
      const profileData: { name?: string; email?: string; phone_number?: string; company_name?: string } = {};
      if (fullName !== user?.name) profileData.name = fullName;
      if (email !== user?.email) profileData.email = email;
      if (phone !== (user?.phone_number || '')) profileData.phone_number = phone;
      if (company !== (user?.company_name || '')) profileData.company_name = company;

      let profileUpdated = false;
      if (Object.keys(profileData).length > 0) {
        const updated = await updateProfile(profileData);
        updateUser(updated);
        profileUpdated = true;
      }

      let passwordUpdated = false;
      if (currentPassword && newPassword) {
        await changePassword({ current_password: currentPassword, new_password: newPassword });
        setCurrentPassword('');
        setNewPassword('');
        passwordUpdated = true;
      }

      if (profileUpdated || passwordUpdated) {
        setMsg({ type: 'success', text: t('changesSaved') });
      } else {
        setMsg({ type: 'success', text: t('noChanges') });
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMsg({ type: 'error', text: detail || t('failedSave') });
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setMsg(null);
    try {
      const updated = await uploadAvatar(file);
      updateUser(updated);
    } catch {
      setMsg({ type: 'error', text: t('failedUploadAvatar') });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleAvatarDelete() {
    setAvatarUploading(true);
    setMsg(null);
    try {
      const updated = await deleteAvatar();
      updateUser(updated);
    } catch {
      setMsg({ type: 'error', text: t('failedDeleteAvatar') });
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleNotifToggle(key: keyof NotificationPreferences) {
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(updated);
    setNotifSaving(true);
    setNotifMsg(null);
    try {
      await updateNotificationPreferences(updated);
      setNotifMsg({ type: 'success', text: t('prefsSaved') });
    } catch {
      // Revert on failure
      setNotifPrefs(notifPrefs);
      setNotifMsg({ type: 'error', text: t('prefsFailedSave') });
    } finally {
      setNotifSaving(false);
    }
  }

  async function handleLanguageChange(lang: string) {
    setLanguage(lang);
    try {
      await updateProfile({ language: lang });
    } catch {
      // Language already changed locally; backend sync failed silently
    }
  }

  function renderContent() {
    if (activeSection === 'account') {
      return (
        <form onSubmit={handleSave} className="settings-account-form">
          <h2 className="settings-section-title">{t('account')}</h2>
          <p className="settings-section-desc">{t('accountDesc')}</p>

          <div className="settings-divider" />

          {/* Profile picture */}
          <div className="settings-avatar-row">
            <div className="settings-avatar">
              {user?.profile_picture ? (
                <img src={`${API_URL}${user.profile_picture}`} alt={user.name} />
              ) : (
                <span className="settings-avatar-placeholder">{getInitials(user?.name)}</span>
              )}
            </div>
            <div className="settings-avatar-info">
              <span className="settings-avatar-label">{t('profilePicture')}</span>
              <span className="settings-avatar-hint">{t('profilePictureHint')}</span>
            </div>
            <div className="settings-avatar-actions">
              <button type="button" className="settings-avatar-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={avatarUploading}>
                {avatarUploading ? <><Loader variant="button" /> {t('uploading')}</> : t('uploadNewPicture')}
              </button>
              {user?.profile_picture && (
                <button type="button" className="settings-avatar-delete-btn" onClick={handleAvatarDelete} disabled={avatarUploading}>
                  {tc('delete')}
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} hidden />
          </div>

          <div className="settings-divider" />

          {/* Full name */}
          <div className="settings-field-row">
            <div className="settings-field">
              <label>{t('firstName')}</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} required />
            </div>
            <div className="settings-field">
              <label>{t('lastName')}</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="settings-divider" />

          {/* Contact email */}
          <div className="settings-field">
            <label>{t('contactEmail')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>

          <div className="settings-divider" />

          {/* Phone number */}
          <div className="settings-field">
            <label>{t('phoneNumber')}</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('phoneNumber')} />
          </div>

          <div className="settings-divider" />

          {/* Company */}
          <div className="settings-field">
            <label>{t('company')}</label>
            <input value={company} onChange={e => setCompany(e.target.value)} placeholder={t('company')} />
          </div>

          <div className="settings-divider" />

          {/* Password */}
          <div className="settings-password-section">
            <label className="settings-password-heading">{t('password')}</label>
            <p className="settings-password-desc">{t('modifyPassword')}</p>
            <div className="settings-field-row">
              <div className="settings-field settings-field-password">
                <label>{t('currentPassword')}</label>
                <div className="settings-input-wrap">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder={t('currentPassword')}
                  />
                  <button type="button" className="settings-password-toggle" onClick={() => setShowCurrentPw(!showCurrentPw)}>
                    {showCurrentPw ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </div>
              <div className="settings-field settings-field-password">
                <label>{t('newPassword')}</label>
                <div className="settings-input-wrap">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder={t('newPassword')}
                  />
                  <button type="button" className="settings-password-toggle" onClick={() => setShowNewPw(!showNewPw)}>
                    {showNewPw ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {msg && <div className={`settings-msg ${msg.type}`}>{msg.text}</div>}

          <button type="submit" className="settings-save-btn" disabled={saving}>
            {saving ? <><Loader variant="button" /> {tc('saving')}</> : t('saveChanges')}
          </button>
        </form>
      );
    }

    if (activeSection === 'notifications') {
      return (
        <div className="settings-notif-section">
          <h2 className="settings-section-title">{t('notifications')}</h2>
          <p className="settings-section-desc">{t('notificationsDesc')}</p>

          <div className="settings-divider" />

          {notifLoading ? (
            <Loader variant="inline" />
          ) : (
            <>
              {/* Email notifications master toggle */}
              <div className="settings-notif-group">
                <div className="settings-notif-group-header">
                  <span className="settings-notif-group-icon"><IconMail /></span>
                  <span className="settings-notif-group-title">{t('emailNotifications')}</span>
                </div>
                <p className="settings-notif-group-desc">{t('emailNotifDesc')}</p>
                <div className="settings-notif-item">
                  <div className="settings-notif-item-info">
                    <span className="settings-notif-item-label">{t('enableEmailNotif')}</span>
                    <span className="settings-notif-item-desc">{t('sendUpdatesTo', { email: user?.email })}</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-toggle${notifPrefs.email_notifications ? ' active' : ''}`}
                    onClick={() => handleNotifToggle('email_notifications')}
                    disabled={notifSaving}
                    aria-pressed={notifPrefs.email_notifications}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
              </div>

              <div className="settings-divider" />

              {/* Per-event notification toggles */}
              <div className="settings-notif-group">
                <div className="settings-notif-group-header">
                  <span className="settings-notif-group-icon"><IconBell /></span>
                  <span className="settings-notif-group-title">{t('orderNotifications')}</span>
                </div>
                <p className="settings-notif-group-desc">{t('orderNotifDesc')}</p>

                <div className="settings-notif-item">
                  <div className="settings-notif-item-info">
                    <span className="settings-notif-item-label">{t('orderCreated')}</span>
                    <span className="settings-notif-item-desc">{t('orderCreatedDesc')}</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-toggle${notifPrefs.notify_order_created ? ' active' : ''}`}
                    onClick={() => handleNotifToggle('notify_order_created')}
                    disabled={notifSaving}
                    aria-pressed={notifPrefs.notify_order_created}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>

                <div className="settings-notif-item">
                  <div className="settings-notif-item-info">
                    <span className="settings-notif-item-label">{t('orderConfirmed')}</span>
                    <span className="settings-notif-item-desc">{t('orderConfirmedDesc')}</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-toggle${notifPrefs.notify_order_confirmed ? ' active' : ''}`}
                    onClick={() => handleNotifToggle('notify_order_confirmed')}
                    disabled={notifSaving}
                    aria-pressed={notifPrefs.notify_order_confirmed}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>

                <div className="settings-notif-item">
                  <div className="settings-notif-item-info">
                    <span className="settings-notif-item-label">{t('orderCancelled')}</span>
                    <span className="settings-notif-item-desc">{t('orderCancelledDesc')}</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-toggle${notifPrefs.notify_order_cancelled ? ' active' : ''}`}
                    onClick={() => handleNotifToggle('notify_order_cancelled')}
                    disabled={notifSaving}
                    aria-pressed={notifPrefs.notify_order_cancelled}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>

                <div className="settings-notif-item">
                  <div className="settings-notif-item-info">
                    <span className="settings-notif-item-label">{t('orderCompleted')}</span>
                    <span className="settings-notif-item-desc">{t('orderCompletedDesc')}</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-toggle${notifPrefs.notify_order_completed ? ' active' : ''}`}
                    onClick={() => handleNotifToggle('notify_order_completed')}
                    disabled={notifSaving}
                    aria-pressed={notifPrefs.notify_order_completed}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
              </div>

              {notifMsg && <div className={`settings-msg ${notifMsg.type}`}>{notifMsg.text}</div>}
            </>
          )}
        </div>
      );
    }

    if (activeSection === 'preferences') {
      return (
        <div className="settings-prefs-section">
          <h2 className="settings-section-title">{t('preferences')}</h2>
          <p className="settings-section-desc">{t('preferencesDesc')}</p>

          <div className="settings-divider" />

          <div className="settings-field">
            <label className="settings-password-heading">{t('languageTitle')}</label>
            <p className="settings-password-desc">{t('languageDesc')}</p>
            <LanguageSelector value={currentLang} onChange={handleLanguageChange} />
          </div>
        </div>
      );
    }

    // Financial - coming soon
    return (
      <div className="settings-coming-soon">
        <h2 className="settings-section-title">{t('financialPayments')}</h2>
        <p>{t('comingSoon')}</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={() => navigate(-1)}>
          <IconBack />
        </button>
        <h1>{t('settings')}</h1>
      </div>

      <div className="settings-body">
        {/* Desktop sidebar */}
        <nav className="settings-sidebar">
          {sidebarSections.map(section => (
            <div key={section.title} className="settings-sidebar-section">
              <span className="settings-sidebar-section-title">{section.title}</span>
              {section.items.map(item => (
                <button
                  key={item.id}
                  className={`settings-sidebar-item${activeSection === item.id ? ' active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="settings-sidebar-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Mobile tabs */}
        <div className="settings-mobile-tabs">
          {sidebarSections.flatMap(s => s.items).map(item => (
            <button
              key={item.id}
              className={`settings-mobile-tab${activeSection === item.id ? ' active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="settings-mobile-tab-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-content">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
