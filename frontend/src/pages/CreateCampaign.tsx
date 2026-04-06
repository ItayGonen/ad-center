import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api';
import { getSpaces, getSpaceDetail, getAudienceProfiles } from '../services/spaces';
import type { SpaceListItem, SpaceDetail, AudienceProfile } from '../services/spaces';
import { useCampaignContext } from '../context/CampaignContext';
import Loader from '../components/Loader';
import FluidDrawer from '../components/FluidDrawer';
import useIsMobile from '../hooks/useIsMobile';
import { API_URL } from '../services/api';

const GOOGLE_MAPS_API_KEY = 'AIzaSyByS98Pc-IX6zxgQ0mbPPr6fGI5wCvVaxE';
const MAP_DEFAULT_CENTER = { lat: 32.0853, lng: 34.7818 };

function getMarkerSvg() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e61e4d';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38"><path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.27 21.73 0 14 0z" fill="' + accent + '"/><circle cx="14" cy="14" r="5" fill="white"/></svg>';
}

interface Props {
  search: string;
  onSearch: (v: string) => void;
}

const PRICE_RANGES = [
  { min: 0, max: Infinity },
  { min: 0, max: 50 },
  { min: 50, max: 100 },
  { min: 100, max: 200 },
  { min: 200, max: Infinity },
];

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

export default function CreateCampaign({ search, onSearch }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, i18n } = useTranslation('spaces');
  const { spaces: campaignSpaces, setSpaces: setCampaignSpaces } = useCampaignContext();
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const returnToMode = searchParams.get('step') === 'mode';
  const [selected, setSelected] = useState<Set<number>>(() =>
    returnToMode && campaignSpaces.length > 0
      ? new Set(campaignSpaces.map(s => s.id))
      : new Set()
  );
  const [step, setStep] = useState(() => returnToMode && campaignSpaces.length > 0 ? 3 : 1);
  const [campaignMode, setCampaignMode] = useState<'simple' | 'advanced' | null>(() =>
    returnToMode ? 'advanced' : null
  );
  const [category, setCategory] = useState('all');
  const [priceIdx, setPriceIdx] = useState(0);
  const [allAudienceProfiles, setAllAudienceProfiles] = useState<AudienceProfile[]>([]);
  const [selectedAudienceIds, setSelectedAudienceIds] = useState<Set<number>>(new Set());
  const [audienceFilterOpen, setAudienceFilterOpen] = useState(false);
  const audienceRef = useRef<HTMLDivElement>(null);
  const audienceMobileRef = useRef<HTMLDivElement>(null);

  // ── Step 2 (Map Review) state ──
  const [spaceDetails, setSpaceDetails] = useState<Map<number, SpaceDetail>>(new Map());
  const [detailsLoading, setDetailsLoading] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [activeMarkerId, setActiveMarkerId] = useState<number | null>(null);
  const [mapSearch, setMapSearch] = useState('');
  const [mapCategory, setMapCategory] = useState('all');
  const [mapPriceIdx, setMapPriceIdx] = useState(0);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addPanelSnap, setAddPanelSnap] = useState<number | string | null>(0.35);
  const [selectedPanelOpen, setSelectedPanelOpen] = useState(false);
  const [selectedPanelSnap, setSelectedPanelSnap] = useState<number | string | null>(0.4);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [justAddedIds, setJustAddedIds] = useState<Set<number>>(new Set());
  const isMobile = useIsMobile();
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });

  // Clean up ?step=mode from URL after restoring state
  useEffect(() => {
    if (searchParams.has('step')) {
      searchParams.delete('step');
      setSearchParams(searchParams, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentLang = i18n.language;
  useEffect(() => {
    getSpaces()
      .then(setSpaces)
      .catch(() => {})
      .finally(() => setLoading(false));
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

  const priceOptions = useMemo(() => [
    { value: 0, label: t('allPrices', { ns: 'common' }) },
    { value: 1, label: t('priceUnder50', { ns: 'common' }) },
    { value: 2, label: t('price50to100', { ns: 'common' }) },
    { value: 3, label: t('price100to200', { ns: 'common' }) },
    { value: 4, label: t('price200plus', { ns: 'common' }) },
  ], [t]);

  // Spaces filtered by search/category/price only (excluding audience) —
  // used to compute which audience options are available.
  const filteredWithoutAudience = useMemo(() => {
    const q = search.toLowerCase().trim();
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

  const filteredSpaces = useMemo(() => {
    if (selectedAudienceIds.size === 0) return filteredWithoutAudience;
    return filteredWithoutAudience.filter(s => {
      const spaceApIds = (s.audience_profiles || []).map(ap => ap.id);
      return spaceApIds.some(id => selectedAudienceIds.has(id));
    });
  }, [filteredWithoutAudience, selectedAudienceIds]);

  // ── Step 2 computed values ──
  const selectedSpacesList = useMemo(() =>
    spaces.filter(s => selected.has(s.id)),
    [spaces, selected],
  );

  const selectedSpacesWithCoords = useMemo(() =>
    selectedSpacesList.filter(s => {
      const d = spaceDetails.get(s.id);
      return d && d.lat != null && d.lng != null;
    }),
    [selectedSpacesList, spaceDetails],
  );

  const addableSpaces = useMemo(() => {
    const q = mapSearch.toLowerCase().trim();
    const range = PRICE_RANGES[mapPriceIdx];
    return spaces.filter(s => {
      if (selected.has(s.id)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !(s.city || '').toLowerCase().includes(q)) return false;
      if (mapCategory !== 'all' && s.space_type?.name !== mapCategory) return false;
      if (s.price_per_day < range.min || s.price_per_day > range.max) return false;
      return true;
    });
  }, [spaces, selected, mapSearch, mapCategory, mapPriceIdx]);

  const toggleSpace = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Step 2 handlers ──
  const handleContinueToMap = useCallback(async () => {
    setDetailsLoading(true);
    setStep(2);
    try {
      const idsToFetch = Array.from(selected).filter(id => !spaceDetails.has(id));
      if (idsToFetch.length > 0) {
        const results = await Promise.all(
          idsToFetch.map(async id => {
            try {
              const d = await getSpaceDetail(id);
              return [id, d] as const;
            } catch {
              return null;
            }
          })
        );
        setSpaceDetails(prev => {
          const next = new Map(prev);
          results.forEach(r => { if (r) next.set(r[0], r[1]); });
          return next;
        });
      }
    } catch {
      // Ensure loading state is always cleared even on unexpected errors
    } finally {
      setDetailsLoading(false);
    }
  }, [selected, spaceDetails]);

  const addSpaceFromMap = useCallback(async (id: number) => {
    // 1. Play exit animation on the card
    setAddingId(id);

    // 2. After the card shrinks away, actually add it
    setTimeout(() => {
      setAddingId(null);
      setSelected(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      // Mark as just-added for sidebar entrance animation
      setJustAddedIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      // Clear just-added after animation completes
      setTimeout(() => {
        setJustAddedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 500);
    }, 300);

    if (!spaceDetails.has(id)) {
      try {
        const d = await getSpaceDetail(id);
        setSpaceDetails(prev => {
          const next = new Map(prev);
          next.set(id, d);
          return next;
        });
      } catch { /* skip */ }
    }
  }, [spaceDetails]);

  const removeSpaceFromMap = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(id);
      if (next.size === 0) setStep(1);
      return next;
    });
    if (activeMarkerId === id) setActiveMarkerId(null);
  }, [activeMarkerId]);

  const fitAllMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || selectedSpacesWithCoords.length === 0) return;
    if (selectedSpacesWithCoords.length === 1) {
      const d = spaceDetails.get(selectedSpacesWithCoords[0].id)!;
      map.panTo({ lat: d.lat!, lng: d.lng! });
      map.setZoom(14);
    } else {
      const bounds = new google.maps.LatLngBounds();
      selectedSpacesWithCoords.forEach(s => {
        const d = spaceDetails.get(s.id)!;
        bounds.extend({ lat: d.lat!, lng: d.lng! });
      });
      map.fitBounds(bounds, 60);
    }
  }, [selectedSpacesWithCoords, spaceDetails]);

  const panToMarker = useCallback((id: number) => {
    const d = spaceDetails.get(id);
    if (d && d.lat != null && d.lng != null && mapRef.current) {
      const map = mapRef.current;
      const target = { lat: d.lat, lng: d.lng };
      const currentZoom = map.getZoom() || 9;
      if (currentZoom >= 12) {
        map.setZoom(10);
        setTimeout(() => {
          map.panTo(target);
          setTimeout(() => map.setZoom(14), 300);
        }, 250);
      } else {
        map.panTo(target);
        map.setZoom(14);
      }
      setActiveMarkerId(id);
    }
  }, [spaceDetails]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    if (selectedSpacesWithCoords.length === 1) {
      const d = spaceDetails.get(selectedSpacesWithCoords[0].id)!;
      map.panTo({ lat: d.lat!, lng: d.lng! });
      map.setZoom(14);
    } else if (selectedSpacesWithCoords.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      selectedSpacesWithCoords.forEach(s => {
        const d = spaceDetails.get(s.id)!;
        bounds.extend({ lat: d.lat!, lng: d.lng! });
      });
      map.fitBounds(bounds, 60);
    }
  }, [selectedSpacesWithCoords, spaceDetails]);

  // Re-fit bounds when selected set changes on the map step
  const prevSelectedCount = useRef(selected.size);
  useEffect(() => {
    if (step !== 2) return;
    const map = mapRef.current;
    if (!map || selectedSpacesWithCoords.length === 0) return;
    // Only re-fit when selection count actually changes
    if (prevSelectedCount.current === selected.size) return;
    prevSelectedCount.current = selected.size;

    const timer = setTimeout(() => {
      if (selectedSpacesWithCoords.length === 1) {
        const d = spaceDetails.get(selectedSpacesWithCoords[0].id)!;
        map.panTo({ lat: d.lat!, lng: d.lng! });
        map.setZoom(14);
      } else {
        const bounds = new google.maps.LatLngBounds();
        selectedSpacesWithCoords.forEach(s => {
          const d = spaceDetails.get(s.id)!;
          bounds.extend({ lat: d.lat!, lng: d.lng! });
        });
        map.fitBounds(bounds, 60);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [step, selectedSpacesWithCoords, spaceDetails, selected.size]);

  const _handleContinue = () => {
    setStep(2);
  };

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-loading">
          <Loader variant="page" />
        </div>
      </div>
    );
  }

  // Navigate directly to booking flow with long_term type
  const startBooking = () => {
    if (selected.size === 0) return;
    const selectedIds = Array.from(selected);
    if (campaignMode === 'advanced') {
      const spacesArr = selectedIds.map(id => spaceDetails.get(id)!).filter(Boolean);
      setCampaignSpaces(spacesArr);
      navigate('/book-advanced');
    } else {
      const firstSpaceId = selectedIds[0];
      const params = new URLSearchParams();
      params.set('type', 'long_term');
      params.set('campaignCreate', 'true');
      params.set('spaces', selectedIds.join(','));
      navigate(`/book/${firstSpaceId}?${params.toString()}`);
    }
  };

  // ─── Step 2: Map Review ───
  if (step === 2) {
    return (
      <div className="cc-map-page">
        {/* Top bar */}
        <div className="cc-map-topbar">
          <button className="cc-back" onClick={() => setStep(1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
          <button className="cc-map-topbar-selected" onClick={() => { setAddPanelOpen(false); setSelectedPanelOpen(prev => !prev); }}>
            <span className={`cc-map-topbar-selected-count${justAddedIds.size > 0 ? ' pulse' : ''}`}>{selected.size}</span>
            {t('selected')}
          </button>
          <button className={`cc-map-topbar-add${addPanelOpen ? ' active' : ''}`} onClick={() => { setSelectedPanelOpen(false); setAddPanelOpen(prev => !prev); }}>
            <span className="cc-map-topbar-add-icon">
              {addPanelOpen ? (
                isMobile ? (
                  /* Down arrow – close drawer on mobile */
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
                ) : (
                  /* Right arrow – slide panel away on desktop */
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="9 6 15 12 9 18"/></svg>
                )
              ) : (
                /* Plus icon – open panel */
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              )}
            </span>
            <span className="cc-map-topbar-add-label">
              {addPanelOpen ? (isMobile ? t('backToMap') : t('close')) : t('addSpaces')}
            </span>
          </button>
        </div>

        {detailsLoading || !isLoaded ? (
          <div className="cc-loading" style={{ minHeight: '60vh' }}>
            <Loader variant="page" />
          </div>
        ) : (
          <>
            {/* Body: sidebar + map */}
            <div className="cc-map-body">
              {/* Sidebar */}
              <div className="cc-map-sidebar">
                <div className="cc-map-sidebar-header">
                  {t('spacesSelected', { count: selected.size })}
                </div>
                <div className="cc-map-sidebar-list">
                  {selectedSpacesList.map(s => (
                    <div
                      key={s.id}
                      className={`cc-map-sidebar-item${activeMarkerId === s.id ? ' active' : ''}${justAddedIds.has(s.id) ? ' just-added' : ''}`}
                      onClick={() => panToMarker(s.id)}
                    >
                      <div className="cc-map-sidebar-item-img">
                        {s.first_image ? (
                          <img src={`${API_URL}${s.first_image}`} alt={s.name} />
                        ) : (
                          <div className="cc-map-sidebar-item-img-placeholder" />
                        )}
                      </div>
                      <div className="cc-map-sidebar-item-info">
                        <span className="cc-map-sidebar-item-name">{s.name}</span>
                        <span className="cc-map-sidebar-item-meta">{[s.city, s.environment].filter(Boolean).join(' \u00b7 ')}</span>
                      </div>
                      <button
                        className="cc-map-sidebar-item-remove"
                        onClick={e => { e.stopPropagation(); removeSpaceFromMap(s.id); }}
                        title={t('removeSpace')}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Map */}
              <div className="cc-map-container">
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={MAP_DEFAULT_CENTER}
                  zoom={9}
                  onLoad={onMapLoad}
                  options={{
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    zoomControl: true,
                    styles: [
                      { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
                    ],
                  }}
                >
                  {selectedSpacesWithCoords.map(space => {
                    const d = spaceDetails.get(space.id)!;
                    return (
                      <MarkerF
                        key={space.id}
                        position={{ lat: d.lat!, lng: d.lng! }}
                        onClick={() => panToMarker(space.id)}
                        icon={{
                          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(getMarkerSvg()),
                          scaledSize: new google.maps.Size(32, 42),
                          anchor: new google.maps.Point(16, 42),
                        }}
                      />
                    );
                  })}
                </GoogleMap>

              </div>{/* close cc-map-container */}

              {/* Add More Spaces — mobile: FluidDrawer, desktop: side panel (part of flex flow) */}
              {isMobile && (
                <FluidDrawer
                  open={addPanelOpen}
                  onOpenChange={(open) => { setAddPanelOpen(open); if (!open) { setAddPanelSnap(0.35); fitAllMarkers(); } }}
                  title={t('addMoreSpaces')}
                  snapPoints={[0.35, 0.6, 1]}
                  activeSnapPoint={addPanelSnap}
                  onSnapPointChange={setAddPanelSnap}
                  fadeFromIndex={1}
                >
                  <div className="cc-map-addmore-panel-header">
                    <span className="cc-map-addmore-panel-title">{t('addMoreSpaces')}</span>
                    <button className="cc-map-addmore-panel-close" onClick={() => { setAddPanelOpen(false); fitAllMarkers(); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div className="cc-map-addmore-filters">
                    <div className="filter-bar-search">
                      <input type="text" className="filter-bar-search-input" placeholder={t('searchSpaces', { ns: 'common' })} value={mapSearch} onChange={e => setMapSearch(e.target.value)} />
                      {mapSearch && (
                        <button type="button" className="filter-bar-search-clear" onClick={() => setMapSearch('')}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      )}
                      <span className="filter-bar-search-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      </span>
                    </div>
                    <FilterDropdown value={mapCategory} options={categoryOptions} onChange={setMapCategory} />
                    <FilterDropdown value={mapPriceIdx} options={priceOptions} onChange={setMapPriceIdx} />
                  </div>
                  <div className="cc-map-addmore-grid">
                    {addableSpaces.map(s => (
                      <div key={s.id} className={`cc-map-addmore-card${addingId === s.id ? ' adding' : ''}`} onClick={() => addingId === null && addSpaceFromMap(s.id)}>
                        <div className="cc-map-addmore-card-img">
                          {s.first_image ? <img src={`${API_URL}${s.first_image}`} alt={s.name} /> : <div className="cc-map-sidebar-item-img-placeholder" />}
                          <span className="cc-map-addmore-card-add">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          </span>
                        </div>
                        <div className="cc-map-addmore-card-info">
                          <span className="cc-map-addmore-card-title">{s.name}</span>
                          <span className="cc-map-addmore-card-meta">{[s.city, s.environment].filter(Boolean).join(' · ')}</span>
                          <span className="cc-map-addmore-card-price">&#8362;{s.price_per_day}/day</span>
                        </div>
                      </div>
                    ))}
                    {addableSpaces.length === 0 && <div className="cc-empty" style={{ gridColumn: '1 / -1' }}>{t('noMoreSpaces')}</div>}
                  </div>
                </FluidDrawer>
              )}

              {/* Desktop side panel — in flex flow so it pushes the map */}
              {!isMobile && (
                <div className={`cc-map-addmore-side${addPanelOpen ? ' open' : ''}`}>
                  <div className="cc-map-addmore-panel-header">
                    <span className="cc-map-addmore-panel-title">{t('addMoreSpaces')}</span>
                    <button className="cc-map-addmore-panel-close" onClick={() => { setAddPanelOpen(false); fitAllMarkers(); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div className="cc-map-addmore-filters">
                    <div className="filter-bar-search">
                      <input type="text" className="filter-bar-search-input" placeholder={t('searchSpaces', { ns: 'common' })} value={mapSearch} onChange={e => setMapSearch(e.target.value)} />
                      {mapSearch && (
                        <button type="button" className="filter-bar-search-clear" onClick={() => setMapSearch('')}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      )}
                      <span className="filter-bar-search-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      </span>
                    </div>
                    <FilterDropdown value={mapCategory} options={categoryOptions} onChange={setMapCategory} />
                    <FilterDropdown value={mapPriceIdx} options={priceOptions} onChange={setMapPriceIdx} />
                  </div>
                  <div className="cc-map-addmore-grid">
                    {addableSpaces.map(s => (
                      <div key={s.id} className={`cc-map-addmore-card${addingId === s.id ? ' adding' : ''}`} onClick={() => addingId === null && addSpaceFromMap(s.id)}>
                        <div className="cc-map-addmore-card-img">
                          {s.first_image ? <img src={`${API_URL}${s.first_image}`} alt={s.name} /> : <div className="cc-map-sidebar-item-img-placeholder" />}
                          <span className="cc-map-addmore-card-add">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          </span>
                        </div>
                        <div className="cc-map-addmore-card-info">
                          <span className="cc-map-addmore-card-title">{s.name}</span>
                          <span className="cc-map-addmore-card-meta">{[s.city, s.environment].filter(Boolean).join(' · ')}</span>
                          <span className="cc-map-addmore-card-price">&#8362;{s.price_per_day}/day</span>
                        </div>
                      </div>
                    ))}
                    {addableSpaces.length === 0 && <div className="cc-empty" style={{ gridColumn: '1 / -1' }}>{t('noMoreSpaces')}</div>}
                  </div>
                </div>
              )}
            </div>{/* close cc-map-body */}

            {/* Selected spaces panel (mobile → FluidDrawer, desktop → hidden) */}
            {isMobile ? (
              <FluidDrawer
                open={selectedPanelOpen}
                onOpenChange={(open) => { setSelectedPanelOpen(open); if (!open) { setSelectedPanelSnap(0.4); fitAllMarkers(); } }}
                title={t('spacesSelected', { count: selected.size })}
                snapPoints={[0.4, 0.85]}
                activeSnapPoint={selectedPanelSnap}
                onSnapPointChange={setSelectedPanelSnap}
                fadeFromIndex={0}
              >
                <div className="cc-map-selected-panel-header">
                  <span className="cc-map-selected-panel-title">{t('spacesSelected', { count: selected.size })}</span>
                  <button className="cc-map-selected-panel-close" onClick={() => { setSelectedPanelOpen(false); fitAllMarkers(); }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div className="cc-map-selected-panel-list">
                  {selectedSpacesList.map(s => (
                    <div key={s.id} className={`cc-map-selected-panel-item${justAddedIds.has(s.id) ? ' just-added' : ''}`} onClick={() => { panToMarker(s.id); setSelectedPanelOpen(false); }}>
                      <div className="cc-map-selected-panel-item-img">
                        {s.first_image ? <img src={`${API_URL}${s.first_image}`} alt={s.name} /> : <div className="cc-map-sidebar-item-img-placeholder" />}
                      </div>
                      <div className="cc-map-selected-panel-item-info">
                        <span className="cc-map-selected-panel-item-name">{s.name}</span>
                        <span className="cc-map-selected-panel-item-meta">{[s.city, s.environment].filter(Boolean).join(' · ')}</span>
                        <span className="cc-map-selected-panel-item-price">&#8362;{s.price_per_day}/day</span>
                      </div>
                      <button className="cc-map-selected-panel-item-remove" onClick={e => { e.stopPropagation(); removeSpaceFromMap(s.id); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </FluidDrawer>
            ) : null}

          </>
        )}

        {/* Sticky bottom bar — always visible during step 2 */}
        <div className="cc-sticky-bar cc-map-sticky">
          <span className="cc-sticky-count">{t('spacesSelected', { count: selected.size })}</span>
          <button
            className="cc-sticky-btn"
            disabled={selected.size === 0}
            onClick={() => setStep(3)}
          >
            {t('continueToBooking')}
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Mode Selection ───
  if (step === 3) {
    return (
      <div className="cc-page cc-mode-page">
        <div className="cc-mode-top">
          <button className="cc-back" onClick={() => setStep(2)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
        </div>

        <div className="cc-mode-hero">
          <h1 className="cc-mode-heading">{t('chooseCampaignMode')}</h1>
          <p className="cc-mode-sub">{t('chooseCampaignModeDesc')}</p>
        </div>

        <div className="cc-mode-cards">
          <button
            className={`cc-mode-card${campaignMode === 'simple' ? ' selected' : ''}`}
            onClick={() => setCampaignMode(prev => prev === 'simple' ? null : 'simple')}
          >
            {campaignMode === 'simple' && (
              <span className="cc-mode-check">
                <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            )}
            <div className="cc-mode-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <span className="cc-mode-card-label">{t('simpleMode')}</span>
            <span className="cc-mode-card-title">{t('simpleModeTitle')}</span>
            <span className="cc-mode-card-desc">{t('simpleModeDesc')}</span>
          </button>

          <button
            className={`cc-mode-card${campaignMode === 'advanced' ? ' selected' : ''}`}
            onClick={() => setCampaignMode(prev => prev === 'advanced' ? null : 'advanced')}
          >
            {campaignMode === 'advanced' && (
              <span className="cc-mode-check">
                <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            )}
            <div className="cc-mode-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            </div>
            <span className="cc-mode-card-label">{t('advancedMode')}</span>
            <span className="cc-mode-card-title">{t('advancedModeTitle')}</span>
            <span className="cc-mode-card-desc">{t('advancedModeDesc')}</span>
          </button>
        </div>

        <div className="cc-sticky-bar">
          <span className="cc-sticky-count">{t('spacesSelected', { count: selected.size })}</span>
          <button
            className="cc-sticky-btn"
            disabled={!campaignMode}
            onClick={startBooking}
          >
            {t('continueToBooking')}
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 1: Select Spaces ───
  return (
    <div className="cc-page">
      <div className="cc-header">
        <h1 className="cc-title">{t('createCampaign', { ns: 'common' })}</h1>
        <p className="cc-subtitle">{t('selectSpaces')}</p>
      </div>

      {/* Desktop filter bar (dropdowns only — search is in navbar) */}
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

      {/* Mobile filter bar (search + dropdowns) */}
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

      <div className="cc-grid">
        {filteredSpaces.map(s => {
          const isSelected = selected.has(s.id);
          return (
            <button
              key={s.id}
              className={`cc-space-card${isSelected ? ' selected' : ''}`}
              onClick={() => toggleSpace(s.id)}
            >
              {isSelected && (
                <span className="cc-space-check">
                  <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
              <div className="cc-space-img">
                {s.first_image ? (
                  <img src={`${API_URL}${s.first_image}`} alt={s.name} />
                ) : (
                  <div className="cc-space-img-placeholder" />
                )}
                {s.estimated_daily_impressions != null && (
                  <span className="cc-space-badge">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {s.estimated_daily_impressions} {t('daily', { ns: 'common' })}
                  </span>
                )}
              </div>
              <div className="cc-space-info">
                <span className="cc-space-title">{s.name}</span>
                {s.space_type && <span className="cc-space-meta">{s.space_type.name}</span>}
                <span className="cc-space-price">&#8362;{s.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></span>
              </div>
            </button>
          );
        })}
      </div>

      {spaces.length > 0 && filteredSpaces.length === 0 && (
        <div className="cc-empty">{t('noSpacesMatchSearch')}</div>
      )}

      <div className="cc-sticky-bar">
        <span className="cc-sticky-count">{t('spacesSelected', { count: selected.size })}</span>
        <button
          className="cc-sticky-btn"
          disabled={selected.size === 0}
          onClick={handleContinueToMap}
        >
          {t('continue', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}
