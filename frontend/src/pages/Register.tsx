import { useState, useMemo } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useTranslation } from 'react-i18next';
import { register, googleLogin, saveGoogleAvatar } from '../services/auth';
import type { User } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import Loader from '../components/Loader';
import GoogleAvatarModal from '../components/GoogleAvatarModal';

export default function Register() {
  const { t } = useTranslation('auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarModal, setAvatarModal] = useState<{ pictureUrl: string; user: User; token: string; navigateTo: string } | null>(null);
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const { setLanguage } = useLanguage();

  // Live password validation
  const pwRules = useMemo(() => ({
    minLength: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match: password.length > 0 && confirmPassword.length > 0 && password === confirmPassword,
  }), [password, confirmPassword]);

  const allPwValid = pwRules.minLength && pwRules.uppercase && pwRules.lowercase && pwRules.special && pwRules.match;
  const hasTypedPassword = password.length > 0;

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) return;
    setError('');
    setLoading(true);
    try {
      const res = await googleLogin(credentialResponse.credential);
      setAuth(res.user, res.access_token);
      if (res.user.language) setLanguage(res.user.language);
      const dest = res.is_new ? '/complete-profile' : '/';
      if (res.google_picture_url && !res.user.profile_picture) {
        setAvatarModal({ pictureUrl: res.google_picture_url, user: res.user, token: res.access_token, navigateTo: dest });
      } else {
        navigate(dest);
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('googleSignupFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('nameIsRequired'));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError(t('invalidEmail'));
      return;
    }

    if (!allPwValid) return;

    setLoading(true);
    try {
      const res = await register({
        email, password, name,
        language: 'en',
      });
      setAuth(res.user, res.access_token);
      navigate('/complete-profile');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('registrationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.svg" alt="Leads" />
        </div>

        <h1>{t('register')}</h1>
        <p className="auth-subtitle">{t('registerSubtitle')}</p>

        {error && <div className="error-msg">{error}</div>}

        <div className="google-login-wrapper">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => setError(t('googleSignupFailed'))}
            width="100%"
          />
        </div>

        <div className="auth-divider"><span>{t('or')}</span></div>

        <form onSubmit={handleSubmit}>
          <div className="auth-row">
            <div className="auth-field">
              <label>{t('nameRequired')}</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t('name')} required />
            </div>
            <div className="auth-field">
              <label>{t('emailRequired')}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" required />
            </div>
          </div>

          <div className="auth-row">
            <div className="auth-field">
              <label>{t('passwordRequired')}</label>
              <div className="password-input-wrapper">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>
            <div className="auth-field">
              <label>{t('confirmPasswordRequired')}</label>
              <div className="password-input-wrapper">
                <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" required />
                <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(v => !v)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                  {showConfirmPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Live password validation checklist */}
          {hasTypedPassword && (
            <ul className="pw-rules">
              {([
                ['minLength', t('ruleMinLength')],
                ['uppercase', t('ruleUppercase')],
                ['lowercase', t('ruleLowercase')],
                ['special', t('ruleSpecialChar')],
                ['match', t('ruleMatch')],
              ] as const).map(([key, label]) => (
                <li key={key} className={`pw-rule${pwRules[key] ? ' pw-rule--pass' : ''}`}>
                  <span className="pw-rule-icon">
                    {pwRules[key] ? (
                      <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" /></svg>
                    )}
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          )}

          <button type="submit" disabled={loading || !allPwValid}>
            {loading ? <><Loader variant="button" className="loader-light" /> {t('registering')}</> : t('register')}
          </button>
        </form>

        <p className="auth-link">{t('alreadyHaveAccount')} <Link to="/login">{t('login')}</Link></p>
      </div>

      {avatarModal && (
        <GoogleAvatarModal
          pictureUrl={avatarModal.pictureUrl}
          onConfirm={async () => {
            const updatedUser = await saveGoogleAvatar(avatarModal.pictureUrl);
            setAuth(updatedUser, avatarModal.token);
            setAvatarModal(null);
            navigate(avatarModal.navigateTo);
          }}
          onDismiss={() => {
            setAvatarModal(null);
            navigate(avatarModal.navigateTo);
          }}
        />
      )}
    </div>
  );
}
