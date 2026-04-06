import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSpaces, getAudienceProfiles } from '../services/spaces';
import type { SpaceListItem, AudienceProfile } from '../services/spaces';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';

interface Props {
  search: string;
  onSearch: (v: string) => void;
}

const PRICE_RANGES = [
  { labelKey: 'allPrices', min: 0, max: Infinity },
  { labelKey: 'price0to20', min: 0, max: 20 },
  { labelKey: 'price20to40', min: 20, max: 40 },
  { labelKey: 'price40plus', min: 40, max: Infinity },
];

/* ---- Reusable Airbnb-style dropdown ---- */
function FilterDropdown<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div className={`fd-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="fd-trigger"
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="fd-trigger-label">{selected?.label ?? ''}</span>
        <svg className="fd-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="fd-menu">
        {options.map(opt => (
          <button
            key={String(opt.value)}
            type="button"
            className={`fd-option${opt.value === value ? ' active' : ''}`}
            onClick={() => { onChange(opt.value); setOpen(false); }}
          >
            {opt.label}
            {opt.value === value && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Locations({ search, onSearch }: Props) {
  const { t, i18n } = useTranslation('spaces');
  const { user } = useAuth();
  const isPartner = user?.role === 'partner';
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');
  const [priceIdx, setPriceIdx] = useState(0);
  const [allAudienceProfiles, setAllAudienceProfiles] = useState<AudienceProfile[]>([]);
  const [selectedAudienceIds, setSelectedAudienceIds] = useState<Set<number>>(new Set());
  const [audienceFilterOpen, setAudienceFilterOpen] = useState(false);
  const audienceRef = useRef<HTMLDivElement>(null);
  const audienceMobileRef = useRef<HTMLDivElement>(null);

  const currentLang = i18n.language;
  useEffect(() => {
    getSpaces().then(data => {
      if (isPartner && user) {
        setSpaces(data.filter(s => s.partner_owner === user.id));
      } else {
        setSpaces(data);
      }
    }).finally(() => setLoading(false));
    getAudienceProfiles(currentLang).then(setAllAudienceProfiles).catch(() => {});
  }, [currentLang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close audience dropdown on outside click
  useEffect(() => {
    if (!audienceFilterOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (audienceRef.current?.contains(target)) return;
      if (audienceMobileRef.current?.contains(target)) return;
      setAudienceFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [audienceFilterOpen]);

  const categories = useMemo(() => {
    const types = new Set<string>();
    spaces.forEach(s => { if (s.space_type) types.add(s.space_type.name); });
    return ['all', ...Array.from(types).sort()];
  }, [spaces]);

  const categoryOptions = useMemo(() =>
    categories.map(cat => ({
      value: cat,
      label: cat === 'all' ? t('allSpaceTypes', { ns: 'common' }) : cat,
    })),
    [categories, t],
  );

  const priceOptions = useMemo(() =>
    PRICE_RANGES.map((r, i) => ({ value: i, label: t(r.labelKey, { ns: 'common' }) })),
    [t],
  );

  // Spaces filtered by search/category/price only (excluding audience) —
  // used to compute which audience options are available.
  const filteredWithoutAudience = useMemo(() => {
    const q = search.toLowerCase();
    const range = PRICE_RANGES[priceIdx];
    return spaces.filter(s => {
      if (q && !s.name.toLowerCase().includes(q) && !(s.city || '').toLowerCase().includes(q)) return false;
      if (category !== 'all' && s.space_type?.name !== category) return false;
      if (s.price_per_day < range.min || s.price_per_day > range.max) return false;
      return true;
    });
  }, [spaces, search, category, priceIdx]);

  // Only show audience profiles that actually exist in the current (non-audience) results
  const availableAudienceProfiles = useMemo(() => {
    const presentIds = new Set<number>();
    filteredWithoutAudience.forEach(s => {
      (s.audience_profiles || []).forEach(ap => presentIds.add(ap.id));
    });
    return allAudienceProfiles.filter(ap => presentIds.has(ap.id));
  }, [allAudienceProfiles, filteredWithoutAudience]);

  const filtered = useMemo(() => {
    if (selectedAudienceIds.size === 0) return filteredWithoutAudience;
    return filteredWithoutAudience.filter(s => {
      const spaceApIds = (s.audience_profiles || []).map(ap => ap.id);
      return spaceApIds.some(id => selectedAudienceIds.has(id));
    });
  }, [filteredWithoutAudience, selectedAudienceIds]);

  if (loading) return <Loader variant="page" />;

  return (
    <div className="locations-page">
      {/* Desktop filter bar */}
      <div className="filter-bar filter-bar-desktop">
        <FilterDropdown value={category} options={categoryOptions} onChange={setCategory} />
        <FilterDropdown value={priceIdx} options={priceOptions} onChange={setPriceIdx} />
        <div className={`fd-dropdown${audienceFilterOpen ? ' open' : ''}`} ref={audienceRef}>
          <button type="button" className="fd-trigger" onClick={() => setAudienceFilterOpen(prev => !prev)}>
            <span className="fd-trigger-label">
              {selectedAudienceIds.size > 0 ? `${t('audience', { ns: 'common' })} (${selectedAudienceIds.size})` : t('audience', { ns: 'common' })}
            </span>
            <svg className="fd-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="fd-menu fd-menu-audience" onMouseDown={e => e.stopPropagation()}>
            {(['Demographic', 'Lifestyle', 'Behavior / Context'] as const).map(cat => {
              const catLabelMap: Record<string, string> = {
                'Demographic': t('demographic', { ns: 'common' }),
                'Lifestyle': t('lifestyle', { ns: 'common' }),
                'Behavior / Context': t('behaviorContext', { ns: 'common' }),
              };
              const catProfiles = availableAudienceProfiles.filter(ap => ap.category === cat);
              if (catProfiles.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="fd-group-label">{catLabelMap[cat]}</div>
                  {catProfiles.map(ap => (
                    <button
                      key={ap.id}
                      type="button"
                      className={`fd-option${selectedAudienceIds.has(ap.id) ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedAudienceIds(prev => {
                          const next = new Set(prev);
                          if (next.has(ap.id)) next.delete(ap.id); else next.add(ap.id);
                          return next;
                        });
                      }}
                    >
                      {ap.name}
                      {selectedAudienceIds.has(ap.id) && (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
            {selectedAudienceIds.size > 0 && (
              <button type="button" className="fd-clear" onClick={() => setSelectedAudienceIds(new Set())}>
                {t('clearAll', { ns: 'common' })}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter bar */}
      <div className="filter-bar-mobile">
        <div className="filter-bar-search">
          <input
            type="text"
            className="filter-bar-search-input"
            placeholder={t('searchSpaces', { ns: 'common' })}
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="filter-bar-search-clear" onClick={() => onSearch('')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          <span className="filter-bar-search-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
        </div>
        <div className="filter-bar-mobile-row">
          <FilterDropdown value={category} options={categoryOptions} onChange={setCategory} />
          <FilterDropdown value={priceIdx} options={priceOptions} onChange={setPriceIdx} />
          <div className={`fd-dropdown${audienceFilterOpen ? ' open' : ''}`} ref={audienceMobileRef}>
            <button type="button" className="fd-trigger" onClick={() => setAudienceFilterOpen(prev => !prev)}>
              <span className="fd-trigger-label">
                {selectedAudienceIds.size > 0 ? `${t('audience', { ns: 'common' })} (${selectedAudienceIds.size})` : t('audience', { ns: 'common' })}
              </span>
              <svg className="fd-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="fd-menu fd-menu-audience" onMouseDown={e => e.stopPropagation()}>
              {(['Demographic', 'Lifestyle', 'Behavior / Context'] as const).map(cat => {
                const catLabelMap: Record<string, string> = {
                  'Demographic': t('demographic', { ns: 'common' }),
                  'Lifestyle': t('lifestyle', { ns: 'common' }),
                  'Behavior / Context': t('behaviorContext', { ns: 'common' }),
                };
                const catProfiles = availableAudienceProfiles.filter(ap => ap.category === cat);
                if (catProfiles.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="fd-group-label">{catLabelMap[cat]}</div>
                    {catProfiles.map(ap => (
                      <button
                        key={ap.id}
                        type="button"
                        className={`fd-option${selectedAudienceIds.has(ap.id) ? ' active' : ''}`}
                        onClick={() => {
                          setSelectedAudienceIds(prev => {
                            const next = new Set(prev);
                            if (next.has(ap.id)) next.delete(ap.id); else next.add(ap.id);
                            return next;
                          });
                        }}
                      >
                        {ap.name}
                        {selectedAudienceIds.has(ap.id) && (
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
              {selectedAudienceIds.size > 0 && (
                <button type="button" className="fd-clear" onClick={() => setSelectedAudienceIds(new Set())}>
                  {t('clearAll', { ns: 'common' })}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{t('noSpacesMatch')}</p>
        </div>
      ) : (
        <div className="spaces-grid">
          {filtered.map(space => (
            <Link to={`/location/${space.id}`} key={space.id} className="space-card">
              <div className="space-card-image">
                {space.first_image ? (
                  <img src={`${API_URL}${space.first_image}`} alt={space.name} />
                ) : (
                  <div className="no-image">{t('noImage', { ns: 'common' })}</div>
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
              <div className="space-card-body">
                <h3>{space.name}</h3>
                {space.space_type && <p className="space-subtitle">{space.space_type.name}</p>}
                <p className="space-price">&#8362;{space.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
