import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getPartnerProfile } from '../services/partner';
import type { PartnerProfile as ProfileData } from '../services/partner';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';

function getInitials(name?: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

export default function PartnerProfile() {
  const { t } = useTranslation('spaces');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !/^\d+$/.test(id)) { navigate('/', { replace: true }); return; }
    getPartnerProfile(Number(id))
      .then(p => { if (p) setProfile(p); else navigate('/', { replace: true }); })
      .catch(() => navigate('/', { replace: true }))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <Loader variant="page" />;
  if (!profile) return null;

  return (
    <div className="partner-profile">
      <div className="partner-profile-header">
        <div className="partner-profile-avatar">
          {profile.profile_picture ? (
            <img src={`${API_URL}${profile.profile_picture}`} alt={profile.name} />
          ) : (
            <span>{getInitials(profile.name)}</span>
          )}
        </div>
        <div className="partner-profile-info">
          <h1>{profile.name}</h1>
          {profile.company_name && <p className="partner-profile-company">{profile.company_name}</p>}
          <span className="partner-profile-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            {t('verifiedPartner', { ns: 'common' })}
          </span>
        </div>
      </div>

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>{t('spacesBy', { name: profile.name })}</h2>
      {profile.spaces.length === 0 ? (
        <p style={{ color: '#6b7280' }}>{t('noSpacesListed')}</p>
      ) : (
        <div className="partner-profile-spaces">
          {profile.spaces.map(space => (
            <Link key={space.id} to={`/location/${space.id}`} className="partner-space-card">
              <div className="partner-space-image">
                {space.first_image ? (
                  <img src={`${API_URL}${space.first_image}`} alt={space.name} />
                ) : (
                  <div className="partner-space-placeholder">{t('noImage', { ns: 'common' })}</div>
                )}
                {space.estimated_daily_impressions != null && (
                  <span className="space-card-badge">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {space.estimated_daily_impressions} {t('daily', { ns: 'common' })}
                  </span>
                )}
              </div>
              <div className="partner-space-info">
                <span className="partner-space-title">{space.name}</span>
                {space.space_type && <span className="partner-space-city">{space.space_type.name}</span>}
                <span className="partner-space-price">&#8362;{space.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
