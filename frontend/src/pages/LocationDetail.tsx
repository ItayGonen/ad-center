import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api';
import { getSpaceDetail } from '../services/spaces';
import Loader from '../components/Loader';
import type { SpaceDetail } from '../services/spaces';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../services/api';

export default function LocationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('spaces');
  const { user, isAuthenticated } = useAuth();
  const isPartner = user?.role === 'partner';
  const bookUrl = isAuthenticated ? `/book/${id}` : '/login';
  const [space, setSpace] = useState<SpaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const touchStartX = useRef(0);
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: 'AIzaSyByS98Pc-IX6zxgQ0mbPPr6fGI5wCvVaxE' });

  const goNext = useCallback(() => setSelectedImage(i => Math.min(i + 1, (space?.images.length ?? 1) - 1)), [space]);
  const goPrev = useCallback(() => setSelectedImage(i => Math.max(i - 1, 0)), []);

  useEffect(() => {
    if (!id || !/^\d+$/.test(id)) { navigate('/', { replace: true }); return; }
    setLoading(true);
    setSelectedImage(0);
    getSpaceDetail(Number(id))
      .then(s => { if (s) setSpace(s); else navigate('/', { replace: true }); })
      .catch(() => navigate('/', { replace: true }))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <Loader variant="page" />;
  if (!space) return null;

  const images = space.images;

  return (
    <div className="loc">
      {/* Mobile-only top bar with back arrow */}
      <div className="loc-mobile-topbar">
        <button onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <div className="loc-mobile-topbar-right">
          <button onClick={() => { if (navigator.share) navigator.share({ title: space?.name, url: window.location.href }); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </button>
        </div>
      </div>

      {/* Desktop: title above gallery */}
      <div className="loc-topbar">
        <button className="loc-back" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <h1 className="loc-title">{space.name}</h1>
      </div>

      {/* Carousel gallery — desktop & mobile */}
      {images.length > 0 && (
        <div
          className="loc-carousel"
          onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const delta = touchStartX.current - e.changedTouches[0].clientX;
            if (delta > 50) goNext();
            else if (delta < -50) goPrev();
          }}
        >
          <div className="loc-carousel-track" style={{ transform: `translateX(-${selectedImage * 100}%)` }}>
            {images.map((img) => (
              <div key={img.id} className="loc-carousel-slide">
                <img src={`${API_URL}${img.image_url}`} alt={space.name} />
              </div>
            ))}
          </div>

          {images.length > 1 && (
            <>
              {selectedImage > 0 && (
                <button className="loc-carousel-nav loc-carousel-prev" onClick={goPrev}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
                </button>
              )}
              {selectedImage < images.length - 1 && (
                <button className="loc-carousel-nav loc-carousel-next" onClick={goNext}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
              )}
              <div className="loc-carousel-dots">
                {images.map((_, i) => (
                  <button key={i} className={`loc-carousel-dot${i === selectedImage ? ' active' : ''}`} onClick={() => setSelectedImage(i)} />
                ))}
              </div>
              <span className="loc-carousel-counter">{selectedImage + 1} / {images.length}</span>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div className="loc-body">
        <button className="loc-back-desktop" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <h1 className="loc-title-mobile">{space.name}</h1>

        {/* Quick summary line: category · city | icon count */}
        <div className="loc-subtitle">
          <span className="loc-subtitle-text">
            {[space.space_type?.name, space.city].filter(Boolean).join(' · ')}
          </span>
          {space.screens && space.screens.filter(s => s.is_active).length > 0 && (
            <>
              <span className="loc-subtitle-sep">|</span>
              <span className="loc-subtitle-screens">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                <span className="loc-subtitle-x">&times;</span>
                {space.screens.filter(s => s.is_active).length}
              </span>
            </>
          )}
        </div>

        {/* Sold by section */}
        {space.name && (
          <>
            <hr className="loc-divider" />
            <div className="loc-host">
              {space.partner_owner ? (
                <Link to={`/partner/${space.partner_owner}`} className="loc-host-avatar-link">
                  {space.partner_profile_picture ? (
                    <img className="loc-host-avatar-img" src={`${API_URL}${space.partner_profile_picture}`} alt={space.partner_name || space.name} />
                  ) : (
                    <div className="loc-host-avatar-fallback">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                  )}
                </Link>
              ) : (
                <div className="loc-host-avatar-fallback">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
              )}
              <div className="loc-host-info">
                {space.partner_owner ? (
                  <Link to={`/partner/${space.partner_owner}`} className="loc-host-name loc-host-link">{t('soldBy', { name: space.partner_name || space.name })}</Link>
                ) : (
                  <span className="loc-host-name">{t('soldBy', { name: space.name })}</span>
                )}
                <span className="loc-host-badge">{t('verifiedPartner', { ns: 'common' })}</span>
              </div>
            </div>
          </>
        )}

        <hr className="loc-divider" />

        {/* Two-column content */}
        <div className="loc-content">
          <div className="loc-main">
            {/* Key highlights */}
            <div className="loc-facts">
              <div className="loc-fact">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 4h12a2 2 0 0 1 2 2"/><circle cx="18" cy="16" r="1"/></svg>
                <div>
                  <span className="loc-fact-title">&#8362;{space.price_per_day} {t('perDay', { ns: 'common' })}</span>
                  <span className="loc-fact-desc">{t('adSpaceRental')}</span>
                </div>
              </div>
              {space.estimated_daily_impressions && (
                <div className="loc-fact">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <div>
                    <span className="loc-fact-title">~{space.estimated_daily_impressions} </span>
                    <span className="loc-fact-desc">{t('estimatedImpressions')}</span>
                  </div>
                </div>
              )}
              {space.environment && (
                <div className="loc-fact">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  <div>
                    <span className="loc-fact-title">{t('environmentType', { type: t(space.environment.toLowerCase(), { ns: 'common' }) })}</span>
                    <span className="loc-fact-desc">{t('locationSetting')}</span>
                  </div>
                </div>
              )}
              {space.average_dwell_time && (
                <div className="loc-fact">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <div>
                    <span className="loc-fact-title">{t('avgDwellTime', { minutes: space.average_dwell_time })}</span>
                    <span className="loc-fact-desc">{t('dwellTimeDesc')}</span>
                  </div>
                </div>
              )}
            </div>

            <hr className="loc-divider" />

            {/* Map section */}
            {space.lat && space.lng && isLoaded && (
              <>
                <div className="loc-map-section">
                  <h3 className="loc-section-title">{t('signLocation')}</h3>
                  {(space.city || space.full_address) && (
                    <p className="loc-map-address">
                      {[space.full_address, space.city].filter(Boolean).join(', ')}
                    </p>
                  )}
                  <div className="loc-map-container">
                    <GoogleMap
                      mapContainerClassName="loc-map"
                      center={{ lat: space.lat, lng: space.lng }}
                      zoom={14}
                      options={{
                        disableDefaultUI: true,
                        zoomControl: true,
                        gestureHandling: 'cooperative',
                      }}
                    >
                      <MarkerF position={{ lat: space.lat, lng: space.lng }} />
                    </GoogleMap>
                  </div>
                </div>
                <hr className="loc-divider" />
              </>
            )}

            {/* Screens */}
            <div className="loc-section">
              <h3 className="loc-section-title">{t('screens')}</h3>
              {(!space.screens || space.screens.filter(s => s.is_active).length === 0) ? (
                <p className="loc-section-text loc-no-data">{t('noScreenData')}</p>
              ) : (
                <>
                  <p className="loc-screens-count">
                    {space.screens.filter(s => s.is_active).length} {space.screens.filter(s => s.is_active).length === 1 ? t('screen') : t('screensPlural')}
                  </p>
                  <div className="loc-screens-list">
                    {space.screens.filter(s => s.is_active).map((screen, idx) => (
                      <div key={screen.id} className="loc-screen-row">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        <div className="loc-screen-info">
                          <span className="loc-screen-name">{screen.name || `${t('screenLabel')} ${idx + 1}`}</span>
                          <span className="loc-screen-specs">{screen.size_inches}" &middot; {screen.resolution_width} &times; {screen.resolution_height}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <hr className="loc-divider" />

            {/* Audience Profiles */}
            {space.audience_profiles && space.audience_profiles.length > 0 && (
              <>
                <div className="loc-section">
                  <h3 className="loc-section-title">{t('audience')}</h3>
                  <div className="loc-audience-tags">
                    {space.audience_profiles.map(ap => (
                      <span key={ap.id} className="loc-audience-tag" data-category={ap.category}>{ap.name}</span>
                    ))}
                  </div>
                </div>
                <hr className="loc-divider" />
              </>
            )}

            {/* Description */}
            {space.general_description && (
              <>
                <div className="loc-section">
                  <h3 className="loc-section-title">{t('aboutSpace')}</h3>
                  <p className="loc-section-text">{space.general_description}</p>
                </div>
              </>
            )}
          </div>

          {/* Sidebar — booking card (desktop) — hidden for partners */}
          {!isPartner && (
            <div className="loc-sidebar">
              <div className="loc-booking-card">
                <div className="loc-booking-price">
                  <span className="loc-booking-amount">&#8362;{space.price_per_day}</span>
                  <span className="loc-booking-unit"> / {t('perDay', { ns: 'common' })}</span>
                </div>
                <Link to={bookUrl} className="loc-booking-btn">{t('bookNow')}</Link>
                {space.estimated_daily_impressions && (
                  <p className="loc-booking-note">
                    {t('peopleSeeDaily', { count: Number(space.estimated_daily_impressions) })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Desktop sticky CTA — hidden for partners */}
      {!isPartner && (
        <div className="loc-cta-desktop">
          <div className="loc-cta-left">
            <span className="loc-cta-amount">&#8362;{space.price_per_day}</span>
            <span className="loc-cta-unit"> / {t('perDay', { ns: 'common' })}</span>
          </div>
          <Link to={bookUrl} className="loc-cta-btn">{t('bookNow')}</Link>
        </div>
      )}

      {/* Mobile sticky CTA — hidden for partners */}
      {!isPartner && (
        <div className="loc-cta-mobile">
          <div className="loc-cta-left">
            <span className="loc-cta-amount">&#8362;{space.price_per_day}</span>
            <span className="loc-cta-unit"> / {t('perDay', { ns: 'common' })}</span>
          </div>
          <Link to={bookUrl} className="loc-cta-btn">{t('bookNow')}</Link>
        </div>
      )}
    </div>
  );
}
