import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useTranslation } from 'react-i18next';
import { login, googleLogin, saveGoogleAvatar } from '../services/auth';
import type { User } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import Loader from '../components/Loader';
import GoogleAvatarModal from '../components/GoogleAvatarModal';

export default function Login() {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarModal, setAvatarModal] = useState<{ pictureUrl: string; user: User; token: string; navigateTo: string } | null>(null);
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const { setLanguage } = useLanguage();

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) return;
    setError('');
    setLoading(true);
    try {
      const res = await googleLogin(credentialResponse.credential);
      setAuth(res.user, res.access_token);
      if (res.user.language) setLanguage(res.user.language);
      const dest = (!res.user.phone_number || !res.user.company_name) ? '/complete-profile' : '/';
      if (res.google_picture_url && !res.user.profile_picture) {
        setAvatarModal({ pictureUrl: res.google_picture_url, user: res.user, token: res.access_token, navigateTo: dest });
      } else {
        navigate(dest);
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('googleLoginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login({ email, password });
      setAuth(res.user, res.access_token);
      if (res.user.language) setLanguage(res.user.language);
      navigate('/');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('loginFailed'));
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

        <h1>{t('login')}</h1>
        <p className="auth-subtitle">{t('loginSubtitle')}</p>

        {error && <div className="error-msg">{error}</div>}

        <div className="google-login-wrapper">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => setError(t('googleLoginFailed'))}
            width="100%"
          />
        </div>

        <div className="auth-divider"><span>{t('or')}</span></div>

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('email')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" required />
          </div>
          <div className="auth-field">
            <label>{t('password')}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? <><Loader variant="button" className="loader-light" /> {t('loggingIn')}</> : t('login')}
          </button>
        </form>

        <p className="auth-link">{t('dontHaveAccount')} <Link to="/register">{t('register')}</Link></p>
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
