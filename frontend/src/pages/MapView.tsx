import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api';
import { getSpaces } from '../services/spaces';
import type { SpaceListItem } from '../services/spaces';
import { getSpaceDetail } from '../services/spaces';
import type { SpaceDetail } from '../services/spaces';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';
import FluidDrawer from '../components/FluidDrawer';
import useIsMobile from '../hooks/useIsMobile';

const GOOGLE_MAPS_API_KEY = 'AIzaSyByS98Pc-IX6zxgQ0mbPPr6fGI5wCvVaxE';

export default function MapView() {
  const { t } = useTranslation('spaces');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPartner = user?.role === 'partner';
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [details, setDetails] = useState<Map<number, SpaceDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [activeInfoId, setActiveInfoId] = useState<number | null>(null);
  // Keep content visible during close animation (350ms panel width transition)
  const [displayedInfoId, setDisplayedInfoId] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedAudienceIds, setSelectedAudienceIds] = useState<Set<number>>(new Set());
  const mapRef = useRef<google.maps.Map | null>(null);
  const isMobile = useIsMobile();

  // Sync displayedInfoId: instant on open, delayed 350ms on close (matches CSS transition)
  useEffect(() => {
    if (activeInfoId !== null) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      setDisplayedInfoId(activeInfoId);
    } else {
      closeTimerRef.current = setTimeout(() => setDisplayedInfoId(null), 350);
    }
    return () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
  }, [activeInfoId]);

  // Bottom sheet state — vaul on mobile, CSS-only on desktop
  // IMPORTANT: never set sheetOpen to false — vaul breaks pointer-events on remount.
  // Instead, snap to COLLAPSED_SNAP (near-zero) to visually hide the drawer.
  const COLLAPSED_SNAP = 0.06;
  const [sheetOpen] = useState(true);
  const [sheetSnap, setSheetSnap] = useState<number | string | null>(0.5);
  const sheetCollapsed = sheetSnap === COLLAPSED_SNAP;
  const sheetPosition = sheetCollapsed ? 'collapsed' : sheetSnap === 0.85 ? 'full' : 'half';

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    getSpaces().then(async (rawList) => {
      const list = isPartner && user ? rawList.filter(s => s.partner_owner === user.id) : rawList;
      setSpaces(list);
      const detailMap = new Map<number, SpaceDetail>();
      await Promise.all(
        list.map(async (s) => {
          try {
            const d = await getSpaceDetail(s.id);
            detailMap.set(s.id, d);
          } catch { /* skip */ }
        })
      );
      setDetails(detailMap);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    spaces.forEach(s => {
      if (s.space_type) types.add(s.space_type.name);
    });
    return Array.from(types).sort();
  }, [spaces]);

  // Derive audience profiles from actual spaces data (only show tags that exist on at least one space)
  const availableAudienceProfiles = useMemo(() => {
    const seen = new Map<number, { id: number; name: string }>();
    spaces.forEach(s => {
      (s.audience_profiles || []).forEach(ap => {
        if (!seen.has(ap.id)) seen.set(ap.id, { id: ap.id, name: ap.name });
      });
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [spaces]);

  const toggleType = useCallback((type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleAudience = useCallback((id: number) => {
    setSelectedAudienceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredSpaces = useMemo(() => {
    let result = spaces;
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.city || '').toLowerCase().includes(q)
      );
    }
    if (selectedTypes.size > 0) {
      result = result.filter(s => s.space_type && selectedTypes.has(s.space_type.name));
    }
    if (selectedAudienceIds.size > 0) {
      result = result.filter(s => {
        const apIds = (s.audience_profiles || []).map(ap => ap.id);
        return apIds.some(id => selectedAudienceIds.has(id));
      });
    }
    return result;
  }, [spaces, searchQuery, selectedTypes, selectedAudienceIds]);

  const spacesWithCoords = useMemo(() =>
    filteredSpaces.filter(s => {
      const d = details.get(s.id);
      return d && d.lat != null && d.lng != null;
    }),
    [filteredSpaces, details],
  );

  // Default center: Israel
  const defaultCenter = { lat: 32.0853, lng: 34.7818 };

  // Use a stable center that doesn't change on every render
  // (otherwise it overrides panTo calls)
  const initialCenter = useRef<{ lat: number; lng: number } | null>(null);
  if (!initialCenter.current) {
    initialCenter.current = spacesWithCoords.length > 0
      ? { lat: details.get(spacesWithCoords[0].id)!.lat!, lng: details.get(spacesWithCoords[0].id)!.lng! }
      : defaultCenter;
  }
  const center = initialCenter.current;

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    // Fit bounds to all markers
    if (spacesWithCoords.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      spacesWithCoords.forEach(s => {
        const d = details.get(s.id)!;
        bounds.extend({ lat: d.lat!, lng: d.lng! });
      });
      map.fitBounds(bounds, 60);
    }
  }, [spacesWithCoords, details]);

  // Fit map to show all visible markers when filters or search change
  const isInitialMount = useRef(true);
  useEffect(() => {
    // Skip the first render — onMapLoad already handles initial bounds
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const map = mapRef.current;
    if (!map || spacesWithCoords.length === 0) return;

    // Small delay so the map finishes any in-progress animation
    const timer = setTimeout(() => {
      if (spacesWithCoords.length === 1) {
        const d = details.get(spacesWithCoords[0].id)!;
        map.panTo({ lat: d.lat!, lng: d.lng! });
        map.setZoom(14);
      } else {
        const bounds = new google.maps.LatLngBounds();
        spacesWithCoords.forEach(s => {
          const d = details.get(s.id)!;
          bounds.extend({ lat: d.lat!, lng: d.lng! });
        });
        map.fitBounds(bounds, 60);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [spacesWithCoords, details]);

  function panToSpace(spaceId: number) {
    const d = details.get(spaceId);
    if (d && d.lat != null && d.lng != null && mapRef.current) {
      const map = mapRef.current;
      const target = { lat: d.lat, lng: d.lng };
      const currentZoom = map.getZoom() || 9;

      // Fly-to effect: zoom out, pan, then zoom back in
      if (currentZoom >= 12) {
        map.setZoom(10);
        setTimeout(() => {
          map.panTo(target);
          setTimeout(() => {
            map.setZoom(14);
          }, 300);
        }, 250);
      } else {
        map.panTo(target);
        map.setZoom(14);
      }

      setActiveInfoId(spaceId);
      setSheetSnap(COLLAPSED_SNAP);

      // Trigger Google Maps resize after the push animation completes
      setTimeout(() => {
        if (mapRef.current) google.maps.event.trigger(mapRef.current, 'resize');
      }, 400);
    }
  }

  if (loading || !isLoaded) return <Loader variant="page" />;

  return (
    <div className="mapview">
      {/* Left: space cards (desktop only) */}
      <div className="mapview-list">
        <div className="mapview-desktop-search">
          <div className="mapview-search-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder={t('searchSpaces', { ns: 'common' })}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="mapview-search-clear" onClick={() => setSearchQuery('')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>
        {availableTypes.length > 0 && (
          <div className="mapview-filters">
            <button className="mapview-filters-header" onClick={() => setFiltersOpen(f => !f)}>
              <span>{t('filters', { ns: 'common' })}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ transform: filtersOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {filtersOpen && (
              <div className="mapview-filter-chips">
                {availableTypes.map(type => (
                  <button
                    key={type}
                    className={`mapview-filter-chip ${selectedTypes.has(type) ? 'active' : ''}`}
                    onClick={() => toggleType(type)}
                  >
                    {type}
                  </button>
                ))}
                {selectedTypes.size > 0 && (
                  <button className="mapview-filters-clear" onClick={() => setSelectedTypes(new Set())}>
                    {t('clear', { ns: 'common' })}
                  </button>
                )}
                {availableAudienceProfiles.length > 0 && (
                  <>
                    <div className="mapview-filter-divider" />
                    {availableAudienceProfiles.map(ap => (
                      <button
                        key={`ap-${ap.id}`}
                        className={`mapview-filter-chip ${selectedAudienceIds.has(ap.id) ? 'active' : ''}`}
                        onClick={() => toggleAudience(ap.id)}
                      >
                        {ap.name}
                      </button>
                    ))}
                    {selectedAudienceIds.size > 0 && (
                      <button className="mapview-filters-clear" onClick={() => setSelectedAudienceIds(new Set())}>
                        {t('clearAudience')}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className="mapview-list-header">
          <span>{filteredSpaces.length} {t('spaces', { ns: 'common' })}</span>
        </div>
        <div className="mapview-list-scroll">
          {filteredSpaces.map(space => {
            const d = details.get(space.id);
            const hasCoords = d && d.lat != null && d.lng != null;
            return (
              <div
                key={space.id}
                className={`mapview-card ${hoveredId === space.id ? 'highlight' : ''}`}
                onMouseEnter={() => setHoveredId(space.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => hasCoords ? panToSpace(space.id) : undefined}
              >
                <div className="mapview-card-img">
                  {space.first_image ? (
                    <img src={`${API_URL}${space.first_image}`} alt="" />
                  ) : (
                    <div className="no-image">{t('noImage', { ns: 'common' })}</div>
                  )}
                </div>
                <div className="mapview-card-body">
                  <h3>{space.name}</h3>
                  {space.space_type && <p className="mapview-card-subtitle">{space.space_type.name}</p>}
                  <p className="mapview-card-price">&#8362;{space.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></p>
                  {/* <Link to={`/location/${space.id}`} className="mapview-card-link" onClick={e => e.stopPropagation()}>
                    {t('viewDetails', { ns: 'common' })}
                  </Link> */}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Google Map (full screen on mobile) */}
      <div className="mapview-map">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={center}
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
          {spacesWithCoords.map(space => {
            const d = details.get(space.id)!;
            return (
              <MarkerF
                key={space.id}
                position={{ lat: d.lat!, lng: d.lng! }}
                onClick={() => panToSpace(space.id)}
                onMouseOver={() => setHoveredId(space.id)}
                onMouseOut={() => setHoveredId(null)}
                icon={{
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38"><path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.27 21.73 0 14 0z" fill="' + (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e61e4d') + '"/><circle cx="14" cy="14" r="5" fill="white"/></svg>'
                  ),
                  scaledSize: new google.maps.Size(32, 42),
                  anchor: new google.maps.Point(16, 42),
                }}
              />
            );
          })}
        </GoogleMap>

        {/* Mobile: top bar (Airbnb-style) */}
        <div className="mapview-mobile-topbar">
          <button className="mapview-mobile-topbar-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
          <div className="mapview-mobile-topbar-search">
            <input
              type="text"
              className="mapview-mobile-topbar-input"
              placeholder={t('searchSpaces', { ns: 'common' })}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {/* {searchQuery && (
              <button className="mapview-mobile-topbar-clear" onClick={() => setSearchQuery('')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )} */}
            <span className="mapview-mobile-topbar-search-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
          </div>
          <button
            className={`mapview-mobile-topbar-filter ${mobileFiltersOpen ? 'active' : ''} ${selectedTypes.size > 0 ? 'has-selection' : ''}`}
            onClick={() => {
              setMobileFiltersOpen(f => {
                const next = !f;
                if (next) setSheetSnap(COLLAPSED_SNAP);  // collapse drawer when opening filters
                else setSheetSnap(0.5);                   // restore drawer when closing filters
                return next;
              });
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
            {selectedTypes.size > 0 && (
              <span className="mapview-mobile-topbar-badge">{selectedTypes.size}</span>
            )}
          </button>
        </div>

        {/* Mobile: filter dropdown (always mounted for smooth CSS transitions) */}
        <div className={`mapview-mobile-filters-dropdown-wrap${mobileFiltersOpen ? ' open' : ''}`}>
          <div className="mapview-mobile-filters-dropdown">
            {availableTypes.map(type => (
              <button
                key={type}
                className={`mapview-filter-chip ${selectedTypes.has(type) ? 'active' : ''}`}
                onClick={() => toggleType(type)}
              >
                {type}
              </button>
            ))}
            {selectedTypes.size > 0 && (
              <button className="mapview-filters-clear" onClick={() => setSelectedTypes(new Set())}>
                {t('clear', { ns: 'common' })}
              </button>
            )}
            {availableAudienceProfiles.length > 0 && (
              <>
                <div className="mapview-filter-divider" />
                {availableAudienceProfiles.map(ap => (
                  <button
                    key={`ap-${ap.id}`}
                    className={`mapview-filter-chip ${selectedAudienceIds.has(ap.id) ? 'active' : ''}`}
                    onClick={() => toggleAudience(ap.id)}
                  >
                    {ap.name}
                  </button>
                ))}
                {selectedAudienceIds.size > 0 && (
                  <button className="mapview-filters-clear" onClick={() => setSelectedAudienceIds(new Set())}>
                    {t('clearAudience')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Mobile: bottom sheet via FluidDrawer (portaled, scroll-isolated) */}
        {isMobile ? (
          <FluidDrawer
            open={sheetOpen}
            onOpenChange={() => {}}
            title={t('spaces', { ns: 'common' })}
            snapPoints={[COLLAPSED_SNAP, 0.35, 0.5, 0.85]}
            activeSnapPoint={sheetSnap}
            onSnapPointChange={(snap) => {
              setSheetSnap(snap);
              if (snap !== COLLAPSED_SNAP) setMobileFiltersOpen(false);
            }}
            fadeFromIndex={2}
            dismissible={false}
            noOverlay
            className="fd-content--mapview"
          >
            <div className="mapview-sheet-header">
              <span>{filteredSpaces.length} {t('spaces', { ns: 'common' })}</span>
            </div>
            <div className="mapview-sheet-grid">
              {filteredSpaces.map(space => {
                const d = details.get(space.id);
                const hasCoords = d && d.lat != null && d.lng != null;
                return (
                  <Link
                    key={space.id}
                    to={`/location/${space.id}`}
                    className="mapview-sheet-card"
                    onClick={(e) => {
                      if (hasCoords) {
                        e.preventDefault();
                        panToSpace(space.id);
                      }
                    }}
                  >
                    <div className="mapview-sheet-card-img">
                      {space.first_image ? (
                        <img src={`${API_URL}${space.first_image}`} alt="" />
                      ) : (
                        <div className="no-image">{t('noImage', { ns: 'common' })}</div>
                      )}
                      {space.estimated_daily_impressions != null && (
                        <span className="mapview-sheet-card-exposure">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          {space.estimated_daily_impressions}
                        </span>
                      )}
                    </div>
                    <div className="mapview-sheet-card-body">
                      <h3>{space.name}</h3>
                      {space.space_type && <p className="mapview-sheet-card-sub">{space.space_type.name}</p>}
                      <p className="mapview-sheet-card-price">&#8362;{space.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </FluidDrawer>
        ) : (
          /* Desktop: keep the original CSS-based sheet (hidden via display: none in CSS) */
          <div className={`mapview-sheet mapview-sheet--${sheetPosition}`}>
            <div className="mapview-sheet-handle"><div className="mapview-sheet-handle-bar" /></div>
            <div className="mapview-sheet-header">
              <span>{filteredSpaces.length} {t('spaces', { ns: 'common' })}</span>
            </div>
            <div className="mapview-sheet-grid">
              {filteredSpaces.map(space => {
                const d = details.get(space.id);
                const hasCoords = d && d.lat != null && d.lng != null;
                return (
                  <Link
                    key={space.id}
                    to={`/location/${space.id}`}
                    className="mapview-sheet-card"
                    onClick={(e) => {
                      if (hasCoords) {
                        e.preventDefault();
                        panToSpace(space.id);
                      }
                    }}
                  >
                    <div className="mapview-sheet-card-img">
                      {space.first_image ? (
                        <img src={`${API_URL}${space.first_image}`} alt="" />
                      ) : (
                        <div className="no-image">{t('noImage', { ns: 'common' })}</div>
                      )}
                    </div>
                    <div className="mapview-sheet-card-body">
                      <h3>{space.name}</h3>
                      {space.space_type && <p className="mapview-sheet-card-sub">{space.space_type.name}</p>}
                      <p className="mapview-sheet-card-price">&#8362;{space.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Mobile: compact space card when a marker is selected */}
        {activeInfoId && sheetCollapsed && (() => {
          const space = spaces.find(s => s.id === activeInfoId);
          if (!space) return null;
          return (
            <div className="mapview-mobile-minicard">
              <button className="mapview-mobile-minicard-close" onClick={() => setActiveInfoId(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <Link to={`/location/${space.id}`} className="mapview-mobile-minicard-link">
                <div className="mapview-mobile-minicard-img">
                  {space.first_image ? (
                    <img src={`${API_URL}${space.first_image}`} alt="" />
                  ) : (
                    <div className="no-image">{t('noImage', { ns: 'common' })}</div>
                  )}
                </div>
                <div className="mapview-mobile-minicard-body">
                  <h3>{space.name}</h3>
                  {space.space_type && <p className="mapview-mobile-minicard-sub">{space.space_type.name}</p>}
                  <p className="mapview-mobile-minicard-price">&#8362;{space.price_per_day}{t('day', { ns: 'common' })}</p>
                  <span className="mapview-mobile-minicard-go">{t('viewDetails', { ns: 'common' })}</span>
                </div>
              </Link>
            </div>
          );
        })()}

        {/* Mobile: FAB to reopen the sheet after dismissal */}
        {isMobile && sheetCollapsed && !activeInfoId && (
          <button className="mapview-mobile-reopen" onClick={() => { setMobileFiltersOpen(false); setSheetSnap(0.5); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="18 15 12 9 6 15"/></svg>
            {filteredSpaces.length} {t('spaces', { ns: 'common' })}
          </button>
        )}
      </div>

      {/* Desktop: detail side-panel (flex sibling — pushes the map) */}
      {(() => {
        const isOpen = activeInfoId !== null;
        // Use displayedInfoId so content stays visible during the 350ms close animation
        const shownSpace = displayedInfoId ? spaces.find(s => s.id === displayedInfoId) : null;
        return (
          <div className={`mapview-desktop-detail${isOpen ? ' open' : ''}`}>
            {shownSpace && (
              <>
                <button className="mapview-desktop-detail-close" onClick={() => {
                  setActiveInfoId(null);
                  setTimeout(() => {
                    if (mapRef.current) google.maps.event.trigger(mapRef.current, 'resize');
                  }, 400);
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <div className="mapview-desktop-detail-img">
                  {shownSpace.first_image ? (
                    <img src={`${API_URL}${shownSpace.first_image}`} alt="" />
                  ) : (
                    <div className="no-image">{t('noImage', { ns: 'common' })}</div>
                  )}
                </div>
                <div className="mapview-desktop-detail-body">
                  <h3>{shownSpace.name}</h3>
                  {shownSpace.space_type && <p className="mapview-desktop-detail-subtitle">{shownSpace.space_type.name}</p>}
                  <p className="mapview-desktop-detail-price">&#8362;{shownSpace.price_per_day} <span>{t('perDay', { ns: 'common' })}</span></p>
                  <Link to={`/location/${shownSpace.id}`} className="mapview-desktop-detail-link">
                    {t('viewDetails', { ns: 'common' })}
                  </Link>
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
