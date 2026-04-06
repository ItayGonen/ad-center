import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Loader from './Loader';
import FluidDrawer from './FluidDrawer';
import useIsMobile from '../hooks/useIsMobile';
import { getSpaces } from '../services/spaces';
import type { SpaceListItem } from '../services/spaces';
import { checkCompatibility, checkScheduleCompatibility, createOrder, duplicateCreatives, createCampaign, setOrderCampaign } from '../services/orders';
import type { CompatibilityResult, SelectedDay, TimeRange, OrderCreateData, ScheduleSlot } from '../services/orders';
import { API_URL } from '../services/api';

interface DuplicateOrderModalProps {
  orderId: number;
  currentSpaceId: number;
  orderData: {
    booking_type: string;
    start_date: string;
    end_date: string;
    selected_days?: SelectedDay[];
    notes?: string;
    campaign_id?: number;
  };
  /** Space IDs that already have a duplicate in this campaign (hidden from list). */
  duplicatedSpaceIds?: number[];
  /** Campaign's original schedule template — used for compat checks instead of primary order slots. */
  scheduleTemplate?: { slots: ScheduleSlot[] } | null;
  open: boolean;
  onClose: () => void;
  onDuplicated: (newOrderId: number, refNumber: string, spaceId: number) => void;
}

type ModalStep = 'select' | 'result' | 'duplicating' | 'success';

const PRICE_RANGES = [
  { labelKey: 'allPrices', min: 0, max: Infinity },
  { labelKey: 'priceUnder50', min: 0, max: 50 },
  { labelKey: 'price50to100', min: 50, max: 100 },
  { labelKey: 'price100to200', min: 100, max: 200 },
  { labelKey: 'price200plus', min: 200, max: Infinity },
];

/* ── tiny inline FilterDropdown (same pattern as BookingFlow) ── */
function FilterDropdown<T extends string | number>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const selected = options.find(o => o.value === value);
  return (
    <div className={`fd-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="fd-trigger" onClick={() => setOpen(p => !p)}>
        <span className="fd-trigger-label">{selected?.label ?? ''}</span>
        <svg className="fd-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="fd-menu">
        {options.map(opt => (
          <button key={String(opt.value)} type="button" className={`fd-option${opt.value === value ? ' active' : ''}`} onClick={() => { onChange(opt.value); setOpen(false); }}>
            {opt.label}
            {opt.value === value && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Convert compatibility available_slots back to SelectedDay[] format
 * (merge consecutive hours into time ranges grouped by date).
 */
function slotsToSelectedDays(slots: { date: string; start_time: string; end_time: string }[]): SelectedDay[] {
  const byDate = new Map<string, { start_time: string; end_time: string }[]>();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push({ start_time: s.start_time, end_time: s.end_time });
  }

  const result: SelectedDay[] = [];
  for (const [date, hourSlots] of byDate) {
    hourSlots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    const ranges: TimeRange[] = [];
    let current = { ...hourSlots[0] };
    for (let i = 1; i < hourSlots.length; i++) {
      if (hourSlots[i].start_time === current.end_time) {
        current.end_time = hourSlots[i].end_time;
      } else {
        ranges.push(current);
        current = { ...hourSlots[i] };
      }
    }
    ranges.push(current);
    result.push({ date, time_ranges: ranges });
  }
  return result;
}

/** Parse "250-300" → { min: 250, max: 300 }; "500" → { min: 500, max: 500 } */
function parseImpressionRange(val?: string): { min: number; max: number } {
  if (!val) return { min: 0, max: 0 };
  const nums = val.match(/\d+/g);
  if (!nums || nums.length === 0) return { min: 0, max: 0 };
  const a = parseInt(nums[0]);
  const b = nums.length > 1 ? parseInt(nums[1]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Round to nearest clean number: <1000 → nearest 100, ≥1000 → nearest 1000 */
function roundExposure(n: number): number {
  if (n < 1000) return Math.round(n / 100) * 100;
  return Math.round(n / 1000) * 1000;
}

export default function DuplicateOrderModal({
  orderId,
  currentSpaceId,
  orderData,
  duplicatedSpaceIds = [],
  scheduleTemplate,
  open,
  onClose,
  onDuplicated,
}: DuplicateOrderModalProps) {
  const { t } = useTranslation('orders');
  const tc = (key: string) => t(key, { ns: 'common' });
  const isMobile = useIsMobile();
  const sheetStartY = useRef(0);

  // Closing animation state
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  // Show loader overlay immediately, then switch to modal when data ready
  useEffect(() => {
    if (open && !visible) {
      setVisible(true);
      setClosing(false);
    }
  }, [open, visible]);

  // Hide when parent sets open=false (without animation, e.g. unmount)
  useEffect(() => {
    if (!open) { setVisible(false); setDataReady(false); }
  }, [open]);

  // Lock body scroll while modal is visible
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  const animatedClose = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); setVisible(false); setDataReady(false); onClose(); }, 280);
  };

  const [step, setStep] = useState<ModalStep>('select');
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [compatMap, setCompatMap] = useState<Record<number, CompatibilityResult | 'loading' | 'error'>>({});
  const [error, setError] = useState('');
  const [newOrderRef, setNewOrderRef] = useState('');
  const [sessionDuplicatedIds, setSessionDuplicatedIds] = useState<Set<number>>(new Set());

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [priceIdx, setPriceIdx] = useState(0);

  const initialDuplicatedRef = useRef<Set<number>>(new Set());
  const expectedCompatCountRef = useRef(0);

  const excludedIds = useMemo(() => {
    const set = new Set(initialDuplicatedRef.current);
    for (const id of sessionDuplicatedIds) set.add(id);
    return set;
  }, [sessionDuplicatedIds]);

  // Load spaces and check compatibility only when modal first opens
  useEffect(() => {
    if (!open) return;
    initialDuplicatedRef.current = new Set(duplicatedSpaceIds);
    setStep('select');
    setSearch('');
    setCategory('all');
    setPriceIdx(0);
    setSelectedSpaceId(null);
    setCompatMap({});
    setError('');
    setNewOrderRef('');
    setSessionDuplicatedIds(new Set());
    setSpacesLoading(true);
    setDataReady(false);
    expectedCompatCountRef.current = 0;

    const excluded = new Set(duplicatedSpaceIds);
    let resolvedCount = 0;

    getSpaces()
      .then(allSpaces => {
        setSpaces(allSpaces);
        const available = allSpaces.filter(s => s.id !== currentSpaceId && !excluded.has(s.id));
        if (available.length === 0) {
          setDataReady(true);
          return;
        }
        expectedCompatCountRef.current = available.length;
        const initial: Record<number, 'loading'> = {};
        for (const s of available) initial[s.id] = 'loading';
        setCompatMap(initial);

        const checkDone = () => {
          resolvedCount++;
          if (resolvedCount >= expectedCompatCountRef.current) {
            setDataReady(true);
          }
        };

        for (const s of available) {
          const checkPromise = scheduleTemplate?.slots?.length
            ? checkScheduleCompatibility(scheduleTemplate.slots, s.id)
            : checkCompatibility(orderId, s.id);
          checkPromise
            .then(result => { setCompatMap(prev => ({ ...prev, [s.id]: result })); checkDone(); })
            .catch(() => { setCompatMap(prev => ({ ...prev, [s.id]: 'error' })); checkDone(); });
        }
      })
      .catch(() => { setError('Failed to load spaces'); setDataReady(true); })
      .finally(() => setSpacesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Filter options
  const categoryOptions = useMemo(() => {
    const available = spaces.filter(s => s.id !== currentSpaceId && !excludedIds.has(s.id));
    const types = new Set(available.map(s => s.space_type?.name).filter(Boolean));
    return [{ value: 'all', label: tc('allSpaceTypes') }, ...Array.from(types).sort().map(tp => ({ value: tp!, label: tp! }))];
  }, [spaces, currentSpaceId, excludedIds, t]);

  const priceOptions = useMemo(() =>
    PRICE_RANGES.map((r, i) => ({ value: i, label: tc(r.labelKey) })),
  [t]);

  const filteredSpaces = useMemo(() => {
    return spaces.filter(s => {
      if (s.id === currentSpaceId || excludedIds.has(s.id)) return false;
      const q = search.toLowerCase().trim();
      if (q && !s.name.toLowerCase().includes(q) && !(s.city || '').toLowerCase().includes(q)) return false;
      if (category !== 'all' && s.space_type?.name !== category) return false;
      const range = PRICE_RANGES[priceIdx];
      if (range && s.price_per_day !== undefined) {
        if (s.price_per_day < range.min || s.price_per_day >= range.max) return false;
      }
      return true;
    });
  }, [spaces, currentSpaceId, excludedIds, search, category, priceIdx]);

  const sortedSpaces = useMemo(() => {
    return [...filteredSpaces].sort((a, b) => {
      const order = (sid: number) => {
        const c = compatMap[sid];
        if (!c || c === 'loading' || c === 'error') return 3;
        if (c.compatibility === 'full') return 0;
        if (c.compatibility === 'partial') return 1;
        return 2;
      };
      return order(a.id) - order(b.id);
    });
  }, [filteredSpaces, compatMap]);

  const handleSelectSpace = (spaceId: number) => {
    const compat = compatMap[spaceId];
    if (!compat || compat === 'loading' || compat === 'error') return;
    if (compat.compatibility === 'none') return;
    setSelectedSpaceId(spaceId);
    setStep('result');
  };

  const handleDuplicate = async () => {
    if (!selectedSpaceId) return;
    const compat = compatMap[selectedSpaceId];
    if (!compat || compat === 'loading' || compat === 'error') return;
    setStep('duplicating');
    setError('');
    try {
      const availableDays = slotsToSelectedDays(compat.available_slots);
      const dates = compat.available_slots.map(s => s.date).sort();
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];

      let campaignId = orderData.campaign_id;
      if (!campaignId) {
        const campaign = await createCampaign({ campaign_type: 'long_term' });
        campaignId = campaign.id;
        await setOrderCampaign(orderId, campaignId);
      }

      const createData: OrderCreateData = {
        space_id: selectedSpaceId,
        booking_type: 'long_term',
        start_date: startDate,
        end_date: endDate,
        selected_days: availableDays,
        notes: orderData.notes,
        campaign_id: campaignId,
      };

      const newOrder = await createOrder(createData);
      try {
        await duplicateCreatives(newOrder.id, orderId);
      } catch {
        // Non-critical
      }
      orderData.campaign_id = campaignId;
      setNewOrderRef(newOrder.reference_number);
      setSessionDuplicatedIds(prev => new Set(prev).add(selectedSpaceId));
      setStep('success');
      onDuplicated(newOrder.id, newOrder.reference_number, selectedSpaceId);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (detail?.message ?? null);
      setError(typeof msg === 'string' ? msg : 'Failed to create duplicate order');
      setStep('result');
    }
  };

  const handleAddAnother = () => {
    setSelectedSpaceId(null);
    setNewOrderRef('');
    setError('');
    setStep('select');
  };

  const selectedCompat = selectedSpaceId ? compatMap[selectedSpaceId] : null;
  const compatibility = selectedCompat && selectedCompat !== 'loading' && selectedCompat !== 'error' ? selectedCompat : null;

  const remainingSpaces = spaces.filter(s => {
    if (s.id === currentSpaceId) return false;
    if (excludedIds.has(s.id)) return false;
    if (s.id === selectedSpaceId) return false;
    const c = compatMap[s.id];
    if (!c || c === 'loading' || c === 'error') return false;
    return c.compatibility !== 'none';
  });

  const dismissSheet = () => {
    if (step !== 'duplicating') animatedClose();
  };

  if (!visible) return null;

  // Show fullpage loader while data is loading
  if (!dataReady) {
    return (
      <>
        <div className="bf-dup-overlay" />
        <div className="aasm-loader-overlay">
          <Loader variant="fullpage" />
        </div>
      </>
    );
  }

  const sheetInner = (
    <>
      {/* Content */}
      <div className="bf-dup-sheet-content">
        {error && <div className="dup-error">{error}</div>}

        {/* Title for non-select steps */}
        {step !== 'select' && (
          <div className="bf-campaign-header">
            <h2>{step === 'success' ? 'Order Duplicated!' : 'Duplicate to Another Space'}</h2>
          </div>
        )}

        {/* Step 1: Space Selection */}
        {step === 'select' && (
          <>
            <div className="aasm-sticky-header">
              <div className="bf-campaign-header">
                <h2>Duplicate to Another Space</h2>
              </div>
              <div className="bf-campaign-filters">
                <div className="filter-bar-search">
                  <input type="text" className="filter-bar-search-input" placeholder={tc('searchSpaces')} value={search} onChange={e => setSearch(e.target.value)} />
                  {search && (
                    <button type="button" className="filter-bar-search-clear" onClick={() => setSearch('')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                  <span className="filter-bar-search-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </span>
                </div>
                <div className="bf-campaign-filter-row">
                  <FilterDropdown value={category} options={categoryOptions} onChange={setCategory} />
                  <FilterDropdown value={priceIdx} options={priceOptions} onChange={setPriceIdx} />
                </div>
              </div>
            </div>

            {/* Schedule summary from campaign template */}
            {scheduleTemplate?.slots && scheduleTemplate.slots.length > 0 && (() => {
              const dates = [...new Set(scheduleTemplate.slots.map(s => s.date))].sort();
              const minDate = dates[0];
              const maxDate = dates[dates.length - 1];
              const fmtDate = (d: string) => { const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
              const hours = scheduleTemplate.slots.map(s => parseInt(s.start_time));
              const minH = Math.min(...hours);
              const maxEndH = Math.max(...scheduleTemplate.slots.map(s => parseInt(s.end_time)));
              return (
                <div className="dup-schedule-summary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span>{fmtDate(minDate)} – {fmtDate(maxDate)}</span>
                  <span className="dup-schedule-sep">·</span>
                  <span>{String(minH).padStart(2, '0')}:00 – {String(maxEndH).padStart(2, '0')}:00</span>
                  <span className="dup-schedule-sep">·</span>
                  <span>{dates.length} {t('days', { ns: 'common', defaultValue: 'days' })}</span>
                </div>
              );
            })()}

            {spacesLoading ? (
              <div className="dup-loading"><Loader variant="inline" /></div>
            ) : sortedSpaces.length === 0 ? (
              <div className="dup-empty">No other spaces available</div>
            ) : (
              <div className="dup-space-grid aasm-space-grid-tall">
                {sortedSpaces.map(space => {
                  const compat = compatMap[space.id];
                  const isLoading = compat === 'loading';
                  const isError = compat === 'error';
                  const result = (compat && compat !== 'loading' && compat !== 'error') ? compat : null;
                  const isNone = result?.compatibility === 'none';
                  const isPartial = result?.compatibility === 'partial';
                  const disabled = isLoading || isError || isNone;
                  const pct = result && result.total_source_slots > 0 ? Math.round((result.available_count / result.total_source_slots) * 100) : 0;
                  const ir = parseImpressionRange(space.estimated_daily_impressions);
                  let cardMinEyes = 0, cardMaxEyes = 0;
                  if (ir.max > 0 && result && result.available_slots.length > 0) {
                    const slotCountByDate = new Map<string, number>();
                    for (const slot of result.available_slots) slotCountByDate.set(slot.date, (slotCountByDate.get(slot.date) || 0) + 1);
                    slotCountByDate.forEach((booked) => {
                      cardMinEyes += (booked / 24) * ir.min;
                      cardMaxEyes += (booked / 24) * ir.max;
                    });
                    cardMinEyes = roundExposure(cardMinEyes);
                    cardMaxEyes = roundExposure(cardMaxEyes);
                  }
                  return (
                    <button key={space.id} className={`dup-space-card${disabled ? ' dup-space-card-disabled' : ''}`} onClick={() => !disabled && handleSelectSpace(space.id)} disabled={disabled}>
                      {space.first_image && <img className="dup-space-card-img" src={`${API_URL}${space.first_image}`} alt={space.name} />}
                      <div className="dup-space-card-body">
                        <span className="dup-space-card-name">{space.name}</span>
                        {space.city && <span className="dup-space-card-meta">{space.city}</span>}
                        {isLoading && <span className="bf-campaign-card-badge bf-badge-loading">{t('checkingSpaces')}</span>}
                        {isError && <span className="bf-campaign-card-badge bf-badge-none">{t('error')}</span>}
                        {isNone && <span className="bf-campaign-card-badge bf-badge-none">{t('spaceAvailNone')}</span>}
                        {result && !isNone && !isLoading && !isError && (
                          <div className="bf-campaign-card-stats">
                            <div className="bf-campaign-card-stat">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                              <span className={isPartial ? 'bf-campaign-card-stat-orange' : ''}>{result.available_count}h{isPartial ? ` (${pct}%)` : ''}</span>
                            </div>
                            {cardMaxEyes > 0 && (
                              <div className="bf-campaign-card-stat bf-campaign-card-stat-eyes">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                <span>~{cardMinEyes !== cardMaxEyes ? `${cardMinEyes.toLocaleString()}–${cardMaxEyes.toLocaleString()}` : cardMaxEyes.toLocaleString()}</span>
                              </div>
                            )}
                            <span className="bf-campaign-card-stat-price">&#8362;{result.estimated_cost.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Step 2: Result */}
        {step === 'result' && compatibility && (() => {
          const selectedSpace = spaces.find(s => s.id === selectedSpaceId);
          const pct = compatibility.total_source_slots > 0 ? Math.round((compatibility.available_count / compatibility.total_source_slots) * 100) : 0;
          const ir = parseImpressionRange(selectedSpace?.estimated_daily_impressions);
          let rMinEyes = 0, rMaxEyes = 0;
          if (ir.max > 0 && compatibility.available_slots.length > 0) {
            const slotCountByDate = new Map<string, number>();
            for (const slot of compatibility.available_slots) slotCountByDate.set(slot.date, (slotCountByDate.get(slot.date) || 0) + 1);
            slotCountByDate.forEach((booked) => {
              rMinEyes += (booked / 24) * ir.min;
              rMaxEyes += (booked / 24) * ir.max;
            });
            rMinEyes = roundExposure(rMinEyes);
            rMaxEyes = roundExposure(rMaxEyes);
          }
          const isPartialResult = compatibility.compatibility === 'partial';
          return (
            <div className="dup-result">
              <div className="dup-result-space"><strong>{compatibility.target_space_name}</strong></div>
              <div className="bf-campaign-card-stats" style={{ justifyContent: 'center', gap: 18, marginTop: 12 }}>
                <div className="bf-campaign-card-stat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span className={isPartialResult ? 'bf-campaign-card-stat-orange' : ''}>{compatibility.available_count}h{isPartialResult ? ` (${pct}%)` : ''}</span>
                </div>
                {rMaxEyes > 0 && (
                  <div className="bf-campaign-card-stat bf-campaign-card-stat-eyes">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>~{rMinEyes !== rMaxEyes ? `${rMinEyes.toLocaleString()}–${rMaxEyes.toLocaleString()}` : rMaxEyes.toLocaleString()}</span>
                  </div>
                )}
                <span className="bf-campaign-card-stat-price">&#8362;{compatibility.estimated_cost.toFixed(2)}</span>
              </div>
              {compatibility.compatibility === 'full' && <p className="dup-result-msg dup-msg-full">{t('spaceAvailFull')}</p>}
              {isPartialResult && (
                <div className="bf-rv-conflict-summary" style={{ marginTop: 12 }}>
                  <div className="bf-rv-conflict-header">
                    <div className="bf-rv-conflict-bar"><div className="bf-rv-conflict-bar-fill" style={{ width: `${pct}%` }} /></div>
                    {/* <span className="bf-rv-conflict-avail">{t('conflictAvailableShort', { hours: compatibility.available_count, pct })}</span> */}
                  </div>
                  <p className="bf-rv-conflict-reason-row">{t('conflictUnifiedReason')}</p>
                </div>
              )}
              {compatibility.compatibility === 'none' && <p className="dup-result-msg dup-msg-none">{t('spaceAvailNone')}</p>}
            </div>
          );
        })()}

        {/* Step 3: Duplicating */}
        {step === 'duplicating' && <div className="dup-loading"><Loader variant="inline" /><p>Creating duplicate order...</p></div>}

        {/* Step 4: Success */}
        {step === 'success' && (
          <div className="dup-success">
            <div className="dup-success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="40" height="40"><path d="M20 6 9 17l-5-5" /></svg></div>
            <p>Your order has been duplicated successfully.</p>
            <p className="dup-success-ref">Reference: <strong>{newOrderRef}</strong></p>
          </div>
        )}
      </div>

      {/* Footer */}
      {step !== 'duplicating' && step !== 'select' && (
        <div className="bf-dup-sheet-bottom">
          {step === 'result' && (
            <>
              <button className="dup-btn dup-btn-back" onClick={() => { setStep('select'); setSelectedSpaceId(null); }}>Back</button>
              <button className="dup-btn dup-btn-primary" disabled={!compatibility || compatibility.compatibility === 'none'} onClick={handleDuplicate}>
                {compatibility?.compatibility === 'full' ? 'Duplicate Order' : 'Duplicate Available Hours'}
              </button>
            </>
          )}
          {step === 'success' && (
            <>
              {remainingSpaces.length > 0 && <button className="dup-btn dup-btn-back" onClick={handleAddAnother}>Add Another Space</button>}
              <button className="dup-btn dup-btn-primary" onClick={animatedClose}>Done</button>
            </>
          )}
        </div>
      )}
    </>
  );

  // Mobile: FluidDrawer
  if (isMobile) {
    return (
      <FluidDrawer
        open={open}
        onOpenChange={(o) => { if (!o) dismissSheet(); }}
        title="Duplicate to Another Space"
        dismissible={step !== 'duplicating'}
      >
        {sheetInner}
      </FluidDrawer>
    );
  }

  // Desktop: existing centered dialog
  const sheetClass = `bf-dup-sheet aasm-sheet${closing ? ' closing' : ' open'}`;
  return (
    <>
      <div className={`bf-dup-overlay${closing ? ' closing' : ''}`} onClick={dismissSheet} />
      <div className={sheetClass}>
        <div className="bf-dup-sheet-handle"><div className="bf-dup-sheet-handle-bar" /></div>
        {sheetInner}
      </div>
    </>
  );
}
