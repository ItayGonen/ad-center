import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from '@react-google-maps/api';
import {
  BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import { Wallet, MapPin, Activity, ShoppingCart } from 'lucide-react';
import { getPartnerDashboard, getPartnerSpaces, getPartnerRevenue, getPartnerOrders, getPartnerOccupancy } from '../services/partner';
import type { PartnerDashboard as DashboardData, PartnerSpaceItem, PartnerRevenue, PartnerOrder } from '../services/partner';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';

const GOOGLE_MAPS_API_KEY = 'AIzaSyByS98Pc-IX6zxgQ0mbPPr6fGI5wCvVaxE';
function getAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e61e4d';
}
const DARK = '#222';

type RevenueRange = 'week' | 'month' | 'year' | 'all';
type OccupancyRange = 'week' | 'month' | 'year';
type OrderStatusFilter = 'all' | 'confirmed' | 'cancelled' | 'pending';
type TabId = 'map' | 'income' | 'comparison';

function getTimeRangeStart(range: 'week' | 'month' | 'year'): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  switch (range) {
    case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
    case 'month': { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
    case 'year': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
  }
}

function formatCurrency(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* ── Segmented Control (dark active state) ── */
function SegmentedControl<T extends string>({
  options, value, onChange, labels,
}: {
  options: T[]; value: T; onChange: (v: T) => void; labels: Record<T, string>;
}) {
  return (
    <div className="partner-dash-seg-ctrl" style={{
      display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12,
      background: '#f5f5f5',
    }}>
      {options.map(o => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: active ? 600 : 500,
              borderRadius: 10, border: 'none', cursor: 'pointer',
              transition: 'all 0.15s', whiteSpace: 'nowrap',
              color: active ? '#fff' : '#888',
              background: active ? DARK : 'transparent',
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            {labels[o]}
          </button>
        );
      })}
    </div>
  );
}

/* ── Custom Recharts Tooltip ── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '10px 14px', border: 'none',
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
    }}>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
        {payload[0]?.payload?.fullName || label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: DARK }}>
        ₪{formatCurrency(payload[0].value)}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════ */
export default function PartnerDashboard() {
  const { t, i18n } = useTranslation('spaces');
  const { t: tc } = useTranslation('common');
  const isRTL = i18n.dir() === 'rtl';

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [spaces, setSpaces] = useState<PartnerSpaceItem[]>([]);
  const [revenue, setRevenue] = useState<PartnerRevenue | null>(null);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [revenueRange, setRevenueRange] = useState<RevenueRange>('all');
  const [occupancyRange, setOccupancyRange] = useState<OccupancyRange>('week');
  const [occupancyRate, setOccupancyRate] = useState(0);
  const [occupancyLoading, setOccupancyLoading] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatusFilter>('all');

  const [activeTab, setActiveTab] = useState<TabId>('map');
  const [tabKey, setTabKey] = useState(0);

  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);

  const { isLoaded: mapsLoaded } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });

  /* ── Load data ── */
  const currentLang = i18n.language;
  useEffect(() => {
    async function load() {
      try {
        const [dash, sp, rev, ord] = await Promise.all([
          getPartnerDashboard(), getPartnerSpaces(currentLang), getPartnerRevenue(), getPartnerOrders(),
        ]);
        setDashboard(dash); setSpaces(sp); setRevenue(rev); setOrders(ord);
      } catch { setError(t('failedLoadDashboard')); }
      finally { setLoading(false); }
    }
    load();
  }, [currentLang]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Fetch occupancy from backend whenever period changes ── */
  useEffect(() => {
    let cancelled = false;
    setOccupancyLoading(true);
    getPartnerOccupancy(occupancyRange)
      .then(data => { if (!cancelled) setOccupancyRate(data.occupancy_rate); })
      .catch(() => { if (!cancelled) setOccupancyRate(0); })
      .finally(() => { if (!cancelled) setOccupancyLoading(false); });
    return () => { cancelled = true; };
  }, [occupancyRange]);

  /* ── Per-space revenue (from orders, keyed by space_id) ── */
  const spaceRevenue = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of orders) {
      if (['approved', 'confirmed', 'completed'].includes(o.status))
        map.set(o.space_id, (map.get(o.space_id) || 0) + o.total_cost);
    }
    return map;
  }, [orders]);

  /* ── Card 1: Total Revenue ── */
  const totalRevenue = useMemo(() => {
    if (!dashboard) return 0;
    if (revenueRange === 'all') return dashboard.partner_revenue;
    const rangeStart = getTimeRangeStart(revenueRange);
    const filtered = orders.filter(o =>
      ['approved', 'confirmed', 'completed'].includes(o.status) &&
      new Date(o.created_at) >= rangeStart
    );
    return Math.round(filtered.reduce((sum, o) => sum + o.total_cost, 0) * 0.8);
  }, [dashboard, orders, revenueRange]);

  /* ── Card 4: Total Orders by status ── */
  const totalOrdersFiltered = useMemo(() => {
    if (orderStatusFilter === 'all') return orders.length;
    const statusMap: Record<string, string[]> = {
      confirmed: ['confirmed', 'approved', 'completed'],
      cancelled: ['cancelled'],
      pending: ['pending'],
    };
    return orders.filter(o => statusMap[orderStatusFilter]?.includes(o.status)).length;
  }, [orders, orderStatusFilter]);

  /* ── Income chart data ── */
  const incomeData = useMemo(() => {
    if (!revenue) return [];

    if (revenue.monthly_revenue.length >= 3) {
      return revenue.monthly_revenue.map(m => ({
        label: m.month.slice(5),
        fullName: m.month,
        revenue: m.partner_share,
      }));
    }

    const dailyMap = new Map<string, number>();
    for (const d of revenue.daily_revenue) {
      dailyMap.set(d.day, d.partner_share);
    }

    const points: { label: string; fullName: string; revenue: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayLabel = `${d.getDate()}/${d.getMonth() + 1}`;
      points.push({
        label: dayLabel,
        fullName: key,
        revenue: dailyMap.get(key) || 0,
      });
    }
    return points;
  }, [revenue]);

  /* ── Comparison chart data ── */
  const comparisonData = useMemo(() => {
    return spaces.map(s => ({
      name: s.name.length > 14 ? s.name.slice(0, 14) + '...' : s.name,
      fullName: s.name,
      revenue: Math.round((spaceRevenue.get(s.id) || 0) * 0.8),
    }));
  }, [spaces, spaceRevenue]);

  /* ── Map spaces + top performers ── */
  const mapSpaces = useMemo(() => spaces.filter(s => s.lat != null && s.lng != null), [spaces]);

  const topSpaces = useMemo(() => {
    return [...mapSpaces]
      .map(s => ({ ...s, rev: Math.round((spaceRevenue.get(s.id) || 0) * 0.8) }))
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 5);
  }, [mapSpaces, spaceRevenue]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapInstanceRef.current = map;
    if (mapSpaces.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      mapSpaces.forEach(s => bounds.extend({ lat: s.lat!, lng: s.lng! }));
      map.fitBounds(bounds, 60);
    }
  }, [mapSpaces]);

  const panToSpace = useCallback((spaceId: number) => {
    const s = mapSpaces.find(sp => sp.id === spaceId);
    if (s && mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat: s.lat!, lng: s.lng! });
      mapInstanceRef.current.setZoom(15);
      setSelectedMarker(spaceId);
    }
  }, [mapSpaces]);

  const handleTabSwitch = (tab: TabId) => { setActiveTab(tab); setTabKey(k => k + 1); };

  if (loading) return <Loader variant="page" />;
  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#999' }}>{error}</div>
  );
  if (!dashboard) return null;

  /* ── Labels ── */
  const revenueLabels: Record<RevenueRange, string> = {
    all: t('allTime'), year: t('year'), month: t('month'), week: t('week'),
  };
  const occupancyLabels: Record<OccupancyRange, string> = {
    week: t('week'), month: t('month'), year: t('year'),
  };
  const orderStatusLabels: Record<OrderStatusFilter, string> = {
    all: t('all'), confirmed: t('confirmed'), cancelled: t('canceled'), pending: t('pending'),
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'map', label: t('mapTab') },
    { id: 'income', label: t('incomeTab') },
    { id: 'comparison', label: t('comparisonTab') },
  ];

  return (
    <div style={{ background: '#f9fafb', minHeight: '100%', direction: isRTL ? 'rtl' : 'ltr' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }} className="px-3 pt-4 pb-8 md:px-8 md:pt-8">

        {/* ── Primary Row — Total Revenue ── */}
        <div className="partner-dash-card partner-dash-revenue" style={{
          background: '#fff', borderRadius: 16,
          boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
          display: 'flex', flexDirection: 'column', gap: 10,
          direction: isRTL ? 'rtl' : 'ltr',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Wallet size={16} color={DARK} strokeWidth={2.5} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#aaa' }}>
              {t('totalRevenue')}
            </span>
          </div>
          <span className="partner-dash-hero partner-dash-hero-revenue" style={{ fontWeight: 800, color: DARK, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 2 }}>
            ₪{formatCurrency(totalRevenue)}
          </span>
          <SegmentedControl
            options={['all', 'year', 'month', 'week'] as RevenueRange[]}
            value={revenueRange} onChange={setRevenueRange} labels={revenueLabels}
          />
        </div>

        {/* ── Secondary Row — 3 KPI Cards ── */}
        <div className="partner-dash-secondary-row">

          {/* Card — Number of Spaces */}
          <div className="partner-dash-card" style={{
            background: '#fff', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', gap: 8,
            direction: isRTL ? 'rtl' : 'ltr',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapPin size={14} color={DARK} strokeWidth={2.5} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#aaa' }}>
                {t('numberOfSpaces')}
              </span>
            </div>
            <span className="partner-dash-hero" style={{ fontWeight: 800, color: DARK, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 2 }}>
              {dashboard.total_spaces}
            </span>
          </div>

          {/* Card — Occupancy Rate */}
          <div className="partner-dash-card" style={{
            background: '#fff', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', gap: 8,
            direction: isRTL ? 'rtl' : 'ltr',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={14} color={DARK} strokeWidth={2.5} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#aaa' }}>
                {t('occupancyRate')}
              </span>
            </div>
            <span className="partner-dash-hero" style={{
              fontWeight: 800, color: DARK, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 2,
              opacity: occupancyLoading ? 0.4 : 1, transition: 'opacity 0.2s',
            }}>
              {occupancyRate}%
            </span>
            <SegmentedControl
              options={['week', 'month', 'year'] as OccupancyRange[]}
              value={occupancyRange} onChange={setOccupancyRange} labels={occupancyLabels}
            />
          </div>

          {/* Card — Total Orders */}
          <div className="partner-dash-card" style={{
            background: '#fff', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', gap: 8,
            direction: isRTL ? 'rtl' : 'ltr',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShoppingCart size={14} color={DARK} strokeWidth={2.5} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#aaa' }}>
                {t('totalOrders')}
              </span>
            </div>
            <span className="partner-dash-hero" style={{ fontWeight: 800, color: DARK, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 2 }}>
              {totalOrdersFiltered}
            </span>
            <SegmentedControl
              options={['all', 'confirmed', 'cancelled', 'pending'] as OrderStatusFilter[]}
              value={orderStatusFilter} onChange={setOrderStatusFilter} labels={orderStatusLabels}
            />
          </div>
        </div>

        {/* ── Main Content Area ── */}
        <div className="partner-dash-tabs-area" style={{
          marginTop: 24, background: '#fff', borderRadius: 16,
          boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {/* Tab Switcher */}
          <div style={{ padding: '16px 16px 0', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
            className="partner-dash-seg-ctrl">
            <div style={{
              display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: '#f5f5f5',
            }}>
              {tabs.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    className="partner-dash-tab-btn"
                    onClick={() => handleTabSwitch(tab.id)}
                    style={{
                      fontWeight: isActive ? 600 : 500,
                      borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                      color: isActive ? '#fff' : '#888',
                      background: isActive ? DARK : 'transparent',
                      boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ padding: '16px 16px 20px', flex: 1, overflow: 'hidden' }}>

            {/* ── Tab: Map ── */}
            {activeTab === 'map' && (
              mapsLoaded ? (
                mapSpaces.length > 0 ? (
                  <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: '100%' }}>
                    <GoogleMap
                      mapContainerStyle={{ width: '100%', height: '100%' }}
                      onLoad={onMapLoad}
                      center={mapSpaces[0] ? { lat: mapSpaces[0].lat!, lng: mapSpaces[0].lng! } : { lat: 32.07, lng: 34.78 }}
                      zoom={10}
                      options={{ disableDefaultUI: false, zoomControl: true, streetViewControl: false, mapTypeControl: false }}
                    >
                      {mapSpaces.map(space => (
                        <MarkerF
                          key={space.id}
                          position={{ lat: space.lat!, lng: space.lng! }}
                          onClick={() => setSelectedMarker(space.id)}
                        />
                      ))}
                      {selectedMarker != null && (() => {
                        const s = mapSpaces.find(sp => sp.id === selectedMarker);
                        if (!s) return null;
                        const rev = Math.round((spaceRevenue.get(s.id) || 0) * 0.8);
                        return (
                          <InfoWindowF position={{ lat: s.lat!, lng: s.lng! }} onCloseClick={() => setSelectedMarker(null)}>
                            <div style={{ minWidth: 180, maxWidth: 240, padding: 4, direction: 'ltr', textAlign: 'left' }}>
                              {s.first_image && (
                                <img src={`${API_URL}${s.first_image}`} alt={s.name}
                                  style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
                              )}
                              <div style={{ fontWeight: 700, fontSize: 14, color: DARK, marginBottom: 2 }}>{s.name}</div>
                              {s.city && <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{s.city}</div>}
                              <div style={{ fontSize: 13, fontWeight: 700, color: DARK, background: '#f3f4f6', padding: '4px 8px', borderRadius: 6, display: 'inline-block' }}>
                                {t('revenueOnMap')}: ₪{formatCurrency(rev)}
                              </div>
                            </div>
                          </InfoWindowF>
                        );
                      })()}
                    </GoogleMap>

                    {/* Top Spaces Overlay — hidden on small mobile via CSS */}
                    {topSpaces.length > 0 && (
                      <div className="partner-dash-top-spaces" style={{
                        position: 'absolute', top: 12,
                        [isRTL ? 'right' : 'left']: 12,
                        zIndex: 10,
                        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
                        borderRadius: 12,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                        direction: isRTL ? 'rtl' : 'ltr',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888', marginBottom: 10 }}>
                          {t('topSpaces')}
                        </div>
                        {topSpaces.map((s, i) => (
                          <button
                            key={s.id}
                            onClick={() => panToSpace(s.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                              padding: '8px 6px', border: 'none', background: selectedMarker === s.id ? '#f9fafb' : 'transparent',
                              borderRadius: 8, cursor: 'pointer',
                              textAlign: isRTL ? 'right' : 'left',
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                            onMouseLeave={e => (e.currentTarget.style.background = selectedMarker === s.id ? '#f9fafb' : 'transparent')}
                          >
                            <span style={{
                              width: 22, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              background: i === 0 ? DARK : '#f3f4f6',
                              color: i === 0 ? '#fff' : '#888',
                            }}>
                              {i + 1}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {s.name}
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: DARK }}>
                                ₪{formatCurrency(s.rev)}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb' }}>
                    {t('noLocationData')}
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <Loader variant="page" />
                </div>
              )
            )}

            {/* ── Tab: Income (Area Chart) ── */}
            {activeTab === 'income' && (
              incomeData.length > 0 ? (
                <div style={{ width: '100%', height: '100%', direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height="100%" key={`income-${tabKey}`}>
                    <AreaChart data={incomeData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                      <defs>
                        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={getAccent()} stopOpacity={0.15} />
                          <stop offset="50%" stopColor={getAccent()} stopOpacity={0.05} />
                          <stop offset="100%" stopColor={getAccent()} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="label" axisLine={false} tickLine={false}
                        tick={{ fontSize: 11, fill: '#bbb', fontWeight: 500 }} dy={10}
                      />
                      <YAxis
                        axisLine={false} tickLine={false}
                        tick={{ fontSize: 10, fill: '#ccc' }}
                        tickFormatter={v => `₪${formatCurrency(v)}`}
                        width={60}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#e0e0e0', strokeWidth: 1, strokeDasharray: '6 4' }} />
                      <Area
                        type="monotone" dataKey="revenue"
                        stroke={DARK} strokeWidth={2.5}
                        fill="url(#incomeGrad)"
                        dot={false}
                        activeDot={{ r: 5, fill: ACCENT, stroke: '#fff', strokeWidth: 2.5 }}
                        isAnimationActive animationDuration={1800} animationEasing="ease-in-out"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb' }}>
                  {t('noOrdersYet')}
                </div>
              )
            )}

            {/* ── Tab: Comparison (Bar Chart) ── */}
            {activeTab === 'comparison' && (
              comparisonData.length > 0 ? (
                <div style={{ width: '100%', height: '100%', direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height="100%" key={`comp-${tabKey}`}>
                    <BarChart data={comparisonData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }} barCategoryGap="20%">
                      <XAxis
                        dataKey="name" axisLine={false} tickLine={false}
                        tick={{ fontSize: 10, fill: '#bbb' }} interval={0}
                        angle={comparisonData.length > 4 ? -25 : 0}
                        textAnchor={comparisonData.length > 4 ? 'end' : 'middle'}
                        height={comparisonData.length > 4 ? 55 : 35} dy={6}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#bbb' }} tickFormatter={v => `₪${formatCurrency(v)}`} width={60} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                      <Bar
                        dataKey="revenue" fill={DARK} radius={[6, 6, 0, 0]}
                        isAnimationActive animationDuration={1500} animationEasing="ease-in-out"
                        activeBar={{ fill: ACCENT }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb' }}>
                  {t('noSpacesAssigned')}
                </div>
              )
            )}
          </div>
        </div>

        {/* ── My Spaces Gallery ── */}
        <div style={{ marginTop: 24 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 16, direction: isRTL ? 'rtl' : 'ltr',
          }}>
            <MapPin size={16} color={DARK} strokeWidth={2.5} />
            <span style={{ fontSize: 15, fontWeight: 700, color: DARK }}>
              {t('mySpaces')}
            </span>
            <span style={{ fontSize: 12, color: '#aaa', fontWeight: 500 }}>
              ({spaces.length})
            </span>
          </div>

          {spaces.length > 0 ? (
            <div className="partner-dash-spaces-grid">
              {spaces.map(space => (
                <Link to={`/location/${space.id}`} key={space.id} className="space-card" style={{ borderRadius: 12 }}>
                  <div className="space-card-image" style={{ aspectRatio: '4 / 3' }}>
                    {space.first_image ? (
                      <img src={`${API_URL}${space.first_image}`} alt={space.name} />
                    ) : (
                      <div className="no-image">{tc('noImage')}</div>
                    )}
                    {space.estimated_daily_impressions != null && (
                      <span className="space-card-badge">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        {space.estimated_daily_impressions} {tc('daily')}
                      </span>
                    )}
                  </div>
                  <div className="space-card-body" style={{ padding: '8px 10px 10px' }}>
                    <h3 style={{ fontSize: 13, marginBottom: 1 }}>{space.name}</h3>
                    {space.space_type && <p className="space-subtitle" style={{ fontSize: 11 }}>{space.space_type.name}</p>}
                    <p className="space-price" style={{ fontSize: 13 }}>&#8362;{space.price_per_day} <span>{tc('perDay')}</span></p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div style={{
              background: '#fff', borderRadius: 16, padding: '40px 20px',
              textAlign: 'center', color: '#bbb',
              boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
            }}>
              {t('noSpacesAssigned')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
