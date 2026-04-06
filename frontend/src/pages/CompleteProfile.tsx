import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { updateProfile } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';
import PhoneInput, { validatePhone } from '../components/PhoneInput';
import Loader from '../components/Loader';

export default function CompleteProfile() {
  const { t } = useTranslation('auth');
  const { isAuthenticated, user, updateUser, loading } = useAuth();
  const { language: currentLang, setLanguage } = useLanguage();
  const [name, setName] = useState(user?.name || '');
  const [companyName, setCompanyName] = useState('');
  const [prefix, setPrefix] = useState('050');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [language, setLangState] = useState(currentLang);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  if (loading) return <Loader variant="page" />;
  if (!isAuthenticated) return <Navigate to="/login" />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const phoneErr = validatePhone(prefix, phoneNumber);
    if (phoneErr) {
      setPhoneError(phoneErr);
      return;
    }
    setPhoneError('');

    setSaving(true);
    try {
      const digits = phoneNumber.replace(/[\s-]/g, '');
      const updated = await updateProfile({
        name,
        company_name: companyName,
        phone_number: prefix + '-' + digits,
        language,
      });
      updateUser(updated);
      setLanguage(language);
      navigate('/');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('failedUpdateProfile'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.svg" alt="Leads" />
        </div>

        <h1>{t('completeProfile')}</h1>
        <p className="auth-subtitle">
          {t('welcomeUser', { name: user?.name })}
        </p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('fullName')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder={t('name')}
            />
          </div>
          <div className="auth-field">
            <label>{t('companyNameRequired')}</label>
            <input
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              required
              placeholder={t('yourCompanyName')}
            />
          </div>
          <div className="auth-field">
            <label>{t('phoneNumberRequired')}</label>
            <PhoneInput
              prefix={prefix}
              onPrefixChange={setPrefix}
              phoneNumber={phoneNumber}
              onPhoneNumberChange={setPhoneNumber}
              required
              error={phoneError}
            />
          </div>
          <div className="auth-field">
            <label>{t('chooseLanguage')}</label>
            <LanguageSelector value={language} onChange={setLangState} />
          </div>
          <button type="submit" disabled={saving}>
            {saving ? <><Loader variant="button" className="loader-light" /> {t('saving', { ns: 'common' })}</> : t('continue')}
          </button>
        </form>
      </div>
    </div>
  );
}
