import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSpaceDetail, getAvailability, getSpaces } from '../services/spaces';
import type { SpaceDetail, SpaceListItem, DayAvailability, HourSlotInfo } from '../services/spaces';
import { createOrder, uploadCreative, getOrderDetail, editOrder, getCreatives, deleteCreative, checkCompatibility, checkCampaignCompatibility, checkScheduleCompatibility, duplicateCreatives, createCampaign, setOrderCampaign, finalizeCampaign } from '../services/orders';
import type { SelectedDay, Creative, CompatibilityResult, OrderCreateData, CampaignCompatibilityTarget, ScheduleSlot } from '../services/orders';
import { Snackbar, Alert } from '@mui/material';
import { ErrorOutline } from '@mui/icons-material';
import Loader from '../components/Loader';
import FluidDrawer from '../components/FluidDrawer';
import useIsMobile from '../hooks/useIsMobile';
import ScheduleSelector, { generateHourSlots } from '../components/ScheduleSelector';
import MediaGuidelines from '../components/MediaGuidelines';
import VideoThumbnail from '../components/VideoThumbnail';
import CreativeVaultPicker from '../components/CreativeVaultPicker';
import type { UserCreative } from '../services/myCreatives';
import { validateFiles } from '../utils/fileValidation';
import { DayPicker } from 'react-day-picker';
import { format, parse, startOfDay, addYears, addDays, addMonths, startOfMonth, endOfMonth } from 'date-fns';
import 'react-day-picker/style.css';
import { API_URL } from '../services/api';

const PRICE_RANGES = [
  { labelKey: 'allPrices', min: 0, max: Infinity },
  { labelKey: 'priceUnder50', min: 0, max: 50 },
  { labelKey: 'price50to100', min: 50, max: 100 },
  { labelKey: 'price100to200', min: 100, max: 200 },
  { labelKey: 'price200plus', min: 200, max: Infinity },
];

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

function fmt(t: string) { return t.slice(0, 5); }

/** Bottom Progress Bar — segmented thin line above the bottom action bar (Airbnb-style) */
function BottomProgressBar({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div className="bf-progress-bar">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className={`bf-progress-bar-seg${i < currentStep ? ' filled' : ''}`} />
      ))}
    </div>
  );
}

/** Floating scroll indicator — minimal pill with label + down arrow */
function ContinueCue({ label, onClick, visible, lifted }: {
  label: string;
  onClick: () => void;
  visible: boolean;
  lifted?: boolean;
}) {
  return (
    <button
      type="button"
      className={`bf-continue-cue${visible ? ' visible' : ''}${lifted ? ' lifted' : ''}`}
      onClick={onClick}
    >
      <span className="bf-continue-cue-label">{label}</span>
      <svg className="bf-continue-cue-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
    </button>
  );
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

/** Parse "HH:MM" to decimal hours (e.g. "09:30" → 9.5). Matches backend precision. */
function parseTimeDecimal(t: string): number {
  const h = parseInt(t.slice(0, 2));
  const m = parseInt(t.slice(3, 5)) || 0;
  return h + m / 60;
}

/** Round to nearest clean number: <1000 → nearest 100, ≥1000 → nearest 1000 */
function roundExposure(n: number): number {
  if (n < 1000) return Math.round(n / 100) * 100;
  return Math.round(n / 1000) * 1000;
}

const SEGMENTS = [
  { key: 'morning',   label: 'segmentMorning',   startH: 5,  endH: 12, icon: 'morning' },
  { key: 'afternoon', label: 'segmentAfternoon', startH: 12, endH: 16, icon: 'afternoon' },
  { key: 'evening',   label: 'segmentEvening',   startH: 16, endH: 29, icon: 'evening' },
] as const;

function getClippedSegments(oh: { start_time: string; end_time: string }) {
  const opStart = parseInt(oh.start_time.slice(0, 2));
  const opEnd = parseInt(oh.end_time.slice(0, 2));
  return SEGMENTS.map(seg => {
    const clippedStart = Math.max(seg.startH, opStart);
    const clippedEnd = Math.min(seg.endH, opEnd);
    if (clippedStart >= clippedEnd) return null;
    const hours: string[] = [];
    for (let h = clippedStart; h < clippedEnd; h++)
      hours.push(`${String(h).padStart(2, '0')}:00`);
    return { key: seg.key, label: seg.label, icon: seg.icon, clippedStart, clippedEnd, hours };
  }).filter(Boolean) as { key: string; label: string; icon: string; clippedStart: number; clippedEnd: number; hours: string[] }[];
}

function SegmentIcon({ type }: { type: string }) {
  if (type === 'morning') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    );
  }
  if (type === 'afternoon') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        <circle cx="12" cy="12" r="4"/>
        <path d="M15.5 14.5c1.5 1 3 2.5 3 4.5H5.5c0-2 1.5-3.5 3-4.5"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

/** Merge availability from multiple spaces using union logic.
 *  If at least one space has availability for a slot, it appears in the merged result.
 *  Operating hours are widened to the widest range across all spaces. */
function mergeAvailability(perSpaceArrays: DayAvailability[][]): DayAvailability[] {
  if (perSpaceArrays.length === 0) return [];
  if (perSpaceArrays.length === 1) return perSpaceArrays[0];

  // Group by date across all spaces
  const byDate = new Map<string, DayAvailability[]>();
  for (const spaceAvail of perSpaceArrays) {
    for (const day of spaceAvail) {
      if (!byDate.has(day.date)) byDate.set(day.date, []);
      byDate.get(day.date)!.push(day);
    }
  }

  const merged: DayAvailability[] = [];
  for (const [date, days] of byDate) {
    // Use union: if any space has available_windows, the date is available
    const hasAnyAvailability = days.some(d => d.available_windows.length > 0);

    // Merge operating hours: widen to the widest range
    let earliestStart = '23:59';
    let latestEnd = '00:00';
    for (const d of days) {
      if (d.operating_hours) {
        if (d.operating_hours.start_time < earliestStart) earliestStart = d.operating_hours.start_time;
        if (d.operating_hours.end_time > latestEnd) latestEnd = d.operating_hours.end_time;
      }
    }

    // Merge available_windows: union of all windows
    const allWindows = days.flatMap(d => d.available_windows);

    // Merge hour_slots: for each hour, use the most available (lowest booked_count)
    const hourSlotMap = new Map<string, HourSlotInfo>();
    for (const d of days) {
      for (const hs of (d.hour_slots || [])) {
        const existing = hourSlotMap.get(hs.hour);
        if (!existing || hs.booked_count < existing.booked_count) {
          hourSlotMap.set(hs.hour, { ...hs });
        }
      }
    }

    merged.push({
      date,
      day_of_week: days[0].day_of_week,
      available_windows: hasAnyAvailability ? (allWindows.length > 0 ? allWindows : days[0].available_windows) : [],
      operating_hours: earliestStart < latestEnd ? { start_time: earliestStart, end_time: latestEnd } : days[0].operating_hours,
      hour_slots: Array.from(hourSlotMap.values()),
    });
  }

  // Sort by date
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

export default function BookingFlow() {
  const { t } = useTranslation('orders');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const editOrderId = searchParams.get('edit');
  const isEditMode = !!editOrderId;
  const bookingType = searchParams.get('type') || 'long_term';
  const isCampaignEdit = searchParams.get('campaignEdit') === 'true';
  const childOrderIds = searchParams.get('children')?.split(',').map(Number).filter(n => !isNaN(n)) || [];
  const isCampaignCreate = searchParams.get('campaignCreate') === 'true';
  const campaignSpaceIds = searchParams.get('spaces')?.split(',').map(Number).filter(n => !isNaN(n)) || [];

  const [space, setSpace] = useState<SpaceDetail | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [availability, setAvailability] = useState<DayAvailability[]>([]);
  const [selectedDayDates, setSelectedDayDates] = useState<Set<string>>(new Set());
  const [selectedHours, setSelectedHours] = useState<Map<string, Set<string>>>(new Map());

  const [slotsExpanded, setSlotsExpanded] = useState(false);

  const [editCampaignId, setEditCampaignId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [creativeFiles, setCreativeFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Map<number, number>>(new Map());
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [success, setSuccess] = useState(false);

  // Wizard multi-step state
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardDir, setWizardDir] = useState<'forward' | 'back' | null>(null);

  const goToWizardStep = (target: number) => {
    setWizardDir(target > wizardStep ? 'forward' : 'back');
    setWizardStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const [orderId, setOrderId] = useState('');
  const [existingCreatives, setExistingCreatives] = useState<Creative[]>([]);
  const [campaignPerSpaceCompat, setCampaignPerSpaceCompat] = useState<Record<number, CompatibilityResult | 'loading' | 'error'>>({});
  const [campaignRemovedSpaces, setCampaignRemovedSpaces] = useState<Set<number>>(new Set());
  const [expandedBreakdownSpace, setExpandedBreakdownSpace] = useState<number | null>(null);
  const [conflictDetailCard, setConflictDetailCard] = useState<{ id: number; name: string; hours: number; conflicts: { date: string; start_time: string; end_time: string; reason: string }[]; totalSourceSlots: number } | null>(null);
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(addDays(startOfDay(new Date()), 1));
  const [calSlideDir, setCalSlideDir] = useState<'left' | 'right' | null>(null);
  const [calSlideKey, setCalSlideKey] = useState(0);
  const [calendarAvailability, setCalendarAvailability] = useState<DayAvailability[]>([]);
  const calAvailFetchedMonths = useRef<Set<string>>(new Set());
  const createdOrderIdRef = useRef<number | null>(null);
  const pendingOrderDataRef = useRef<OrderCreateData | null>(null);
  const pendingScheduleSlotsRef = useRef<ScheduleSlot[]>([]);
  const skipNextLtFetchRef = useRef(false);
  const lastFetchedRangeRef = useRef<string>('');

  // Step 4 — "More Spaces" campaign builder
  const [showDuplicateSheet, setShowDuplicateSheet] = useState(false);
  const savedCampaignSpacesRef = useRef<SpaceListItem[]>([]);
  const [campaignSpaces, setCampaignSpaces] = useState<SpaceListItem[]>([]);
  const [campaignCompat, setCampaignCompat] = useState<Record<number, CompatibilityResult | 'loading' | 'error'>>({});
  const [campaignSelected, setCampaignSelected] = useState<Set<number>>(new Set());
  const [campaignCreating, setCampaignCreating] = useState(false);
  const [campaignCreated, setCampaignCreated] = useState<{
    spaceTitle: string; ref: string; cost: number;
    hours: number; compatibility: string; image?: string; city?: string;
  }[]>([]);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignCategory, setCampaignCategory] = useState<string>('all');
  const [campaignPriceIdx, setCampaignPriceIdx] = useState(0);
  const [campaignReview, setCampaignReview] = useState(false);

  // Extra spaces added via bottom sheet in campaign mode
  const [campaignExtraSpaceIds, setCampaignExtraSpaceIds] = useState<number[]>([]);

  // Campaign edit mode state
  const [campaignEditResults, setCampaignEditResults] = useState<(CompatibilityResult & { childId: number; spaceTitle: string })[]>([]);
  const [campaignEditSelected, setCampaignEditSelected] = useState<Set<number>>(new Set());
  const [campaignEditApplying, setCampaignEditApplying] = useState(false);
  const [campaignEditDone, setCampaignEditDone] = useState<{ childId: number; spaceTitle: string; success: boolean; ref?: string; error?: string }[]>([]);

  // Refs for scroll-on-click targets
  const ltScheduleRef = useRef<HTMLDivElement>(null);
  const ltUploadRef = useRef<HTMLDivElement>(null);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Track which sections are scrolled into view (hides continue cue when target is visible)
  const [sectionsInView, setSectionsInView] = useState({ ltSchedule: false, ltUpload: false });

  useEffect(() => {
    const mapping: [React.RefObject<HTMLDivElement | null>, keyof typeof sectionsInView][] = [
      [ltScheduleRef, 'ltSchedule'],
      [ltUploadRef, 'ltUpload'],
    ];
    const observer = new IntersectionObserver(
      (entries) => {
        setSectionsInView(prev => {
          const next = { ...prev };
          for (const entry of entries) {
            for (const [ref, key] of mapping) {
              if (entry.target === ref.current) {
                next[key] = entry.isIntersecting;
              }
            }
          }
          return next;
        });
      },
      { threshold: 0.1, rootMargin: '-40% 0px -40% 0px' }
    );
    for (const [ref] of mapping) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, [startDate, endDate, selectedHours]); // re-observe when sections mount/unmount

  // Long-term progressive flow state
  const [ltLoadingAvailability, setLtLoadingAvailability] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !/^\d+$/.test(id)) { navigate('/', { replace: true }); return; }
    getSpaceDetail(Number(id))
      .then(s => { if (s) setSpace(s); else navigate('/', { replace: true }); })
      .catch(() => navigate('/', { replace: true }));
  }, [id, navigate]);

  // Pre-fetch campaign spaces for cost estimate when coming from CreateCampaign
  useEffect(() => {
    if (!isCampaignCreate || campaignSpaceIds.length === 0) return;
    getSpaces().then(all => {
      setCampaignSpaces(all.filter(s => campaignSpaceIds.includes(s.id)));
    });
  }, []);

  // In edit mode, load existing order
  useEffect(() => {
    if (!isEditMode || !editOrderId) return;
    getOrderDetail(Number(editOrderId)).then(order => {
      // Safety: if type param is missing, redirect with the correct type
      if (!bookingType && order.booking_type) {
        navigate(`/book/${id}?type=${order.booking_type}&edit=${editOrderId}`, { replace: true });
        return;
      }
      // Skip the auto-fetch so it doesn't clear selections loaded from the order
      if (bookingType === 'long_term') skipNextLtFetchRef.current = true;

      setEditCampaignId(order.campaign_id || null);
      setStartDate(order.start_date);
      setEndDate(order.end_date);
      setNotes(order.notes || '');

      {
        // Long-term edit: build from time_slots
        const dayDates = new Set<string>();
        const hours = new Map<string, Set<string>>();
        for (const slot of order.time_slots) {
          dayDates.add(slot.date);
          if (!hours.has(slot.date)) hours.set(slot.date, new Set());
          const startH = parseInt(slot.start_time.slice(0, 2));
          const endH = parseInt(slot.end_time.slice(0, 2));
          for (let h = startH; h < endH; h++) {
            hours.get(slot.date)!.add(`${String(h).padStart(2, '0')}:00`);
          }
        }
        setSelectedDayDates(dayDates);
        setSelectedHours(hours);
      }

      // In long-term edit mode, fetch availability without clearing selections
      if (bookingType === 'long_term') {
        setLtLoadingAvailability(true);
        getAvailability(Number(id), order.start_date, order.end_date, Number(editOrderId))
          .then(data => { setAvailability(data); lastFetchedRangeRef.current = `${order.start_date}|${order.end_date}`; })
          .catch(() => setError(t('fetchAvailabilityFailed')))
          .finally(() => setLtLoadingAvailability(false));
      }
    });
    getCreatives(Number(editOrderId)).then(setExistingCreatives);
  }, [isEditMode, editOrderId, bookingType]);

  const todayDate = startOfDay(new Date());
  const tomorrowDate = addDays(todayDate, 1);
  const today = format(todayDate, 'yyyy-MM-dd');
  const tomorrow = format(tomorrowDate, 'yyyy-MM-dd');

  function timeToMin(t: string): number {
    return parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3, 5));
  }
  function _minToTime(m: number): string {
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  // ─── Long-term flow helpers (same as before) ───
  const canGoToStep2 = startDate && endDate && startDate >= tomorrow && endDate >= startDate;

  const _handleDayClick = (day: Date) => {
    const formatted = format(day, 'yyyy-MM-dd');
    if (activeField === 'from') {
      setStartDate(formatted);
      if (endDate && formatted > endDate) setEndDate('');
      setActiveField('to');
    } else if (activeField === 'to') {
      if (startDate && formatted < startDate) {
        setStartDate(formatted);
        return;
      }
      setEndDate(formatted);
      setActiveField(null);
    }
  };

  const _fetchAvailability = async () => {
    if (!canGoToStep2 || !id) return;
    setError('');
    try {
      const data = await getAvailability(Number(id), startDate, endDate, isEditMode ? Number(editOrderId) : undefined);
      setAvailability(data);
      setSelectedDayDates(new Set());
      setSelectedHours(new Map());
      setStep(2);
    } catch {
      setError(t('fetchAvailabilityFailed'));
    }
  };

  // ─── Long-term: auto-fetch availability when both dates valid ───
  const fetchLtAvailability = useCallback(async (sd: string, ed: string) => {
    if (!id || !sd || !ed || ed < sd) return;
    // For new orders, start date must be at least tomorrow; for edits allow today/past start
    if (!isEditMode && sd < tomorrow) return;
    setLtLoadingAvailability(true);
    setError('');
    try {
      let data: DayAvailability[];

      if (isCampaignCreate && campaignSpaceIds.length > 0) {
        // Fetch availability for ALL campaign spaces and merge with union logic
        const results = await Promise.allSettled(
          campaignSpaceIds.map(spaceId => getAvailability(spaceId, sd, ed))
        );
        const perSpaceArrays: DayAvailability[][] = [];
        for (const r of results) {
          if (r.status === 'fulfilled') perSpaceArrays.push(r.value);
        }
        data = mergeAvailability(perSpaceArrays);
      } else {
        data = await getAvailability(Number(id), sd, ed, isEditMode ? Number(editOrderId) : undefined);
      }

      setAvailability(data);
      // Clear selections only when the date range actually changed
      const rangeKey = `${sd}|${ed}`;
      if (rangeKey !== lastFetchedRangeRef.current) {
        setSelectedDayDates(new Set());
        setSelectedHours(new Map());
        setActivePreset(null);
      }
      lastFetchedRangeRef.current = rangeKey;
    } catch {
      setError(t('fetchAvailabilityFailed'));
    } finally {
      setLtLoadingAvailability(false);
    }
  }, [id, tomorrow, isEditMode, editOrderId, isCampaignCreate, campaignSpaceIds.length]);

  useEffect(() => {
    if (bookingType === 'long_term' && startDate && endDate && endDate >= startDate && (isEditMode || startDate >= tomorrow)) {
      if (skipNextLtFetchRef.current) {
        skipNextLtFetchRef.current = false;
        return;
      }
      fetchLtAvailability(startDate, endDate);
    }
  }, [bookingType, startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Dates where every operating-hour slot is fully booked (sold out). */
  const soldOutDates = useMemo(() => {
    const seen = new Set<string>();
    const dates: Date[] = [];
    // Merge both sources: calendar pre-fetch + selected-range availability
    for (const day of [...calendarAvailability, ...availability]) {
      if (seen.has(day.date)) continue;
      seen.add(day.date);
      const slots = generateHourSlots(day);
      if (slots.length > 0 && slots.every(s => !s.available)) {
        dates.push(parse(day.date, 'yyyy-MM-dd', new Date()));
      }
    }
    return dates;
  }, [availability, calendarAvailability]);

  /** Navigate calendar with slide animation */
  const navigateCalendar = useCallback((newMonth: Date) => {
    const dir = newMonth > calendarMonth ? 'left' : 'right';
    setCalSlideDir(dir);
    setCalSlideKey(k => k + 1);
    setCalendarMonth(newMonth);
  }, [calendarMonth]);

  // Pre-fetch availability for visible calendar month so sold-out dates show immediately
  useEffect(() => {
    const spaceId = Number(id);
    if (!spaceId || bookingType !== 'long_term') return;
    const monthKey = format(calendarMonth, 'yyyy-MM');
    if (calAvailFetchedMonths.current.has(monthKey)) return;
    calAvailFetchedMonths.current.add(monthKey);
    const sd = format(startOfMonth(calendarMonth), 'yyyy-MM-dd');
    const ed = format(endOfMonth(calendarMonth), 'yyyy-MM-dd');
    getAvailability(spaceId, sd, ed)
      .then(data => setCalendarAvailability(prev => {
        const existingDates = new Set(prev.map(d => d.date));
        return [...prev, ...data.filter(d => !existingDates.has(d.date))];
      }))
      .catch(() => {/* silent — calendar pre-fetch is best-effort */});
  }, [calendarMonth, id, bookingType]);

  // Determine if long-term schedule has any hours selected
  const ltHasSchedule = (() => {
    let count = 0;
    selectedHours.forEach(s => count += s.size);
    return count > 0;
  })();


  /** Apply a schedule preset (toggle off if already active) */
  const applyPreset = (preset: string) => {
    if (activePreset === preset) {
      setActivePreset(null);
      setSelectedDayDates(new Set<string>());
      setSelectedHours(new Map<string, Set<string>>());
      return;
    }
    setActivePreset(preset);
    const nextDayDates = new Set<string>();
    const nextHours = new Map<string, Set<string>>();

    for (const day of availability) {
      if (day.available_windows.length === 0) continue;
      const slots = generateHourSlots(day);
      const availableHourStrs = slots.filter(s => s.available).map(s => s.hour);
      if (availableHourStrs.length === 0) continue;

      const isWeekend = day.day_of_week === 5 || day.day_of_week === 6;

      if (preset === 'all_day') {
        nextDayDates.add(day.date);
        nextHours.set(day.date, new Set(availableHourStrs));
      } else if (preset === 'weekends') {
        if (isWeekend) {
          nextDayDates.add(day.date);
          nextHours.set(day.date, new Set(availableHourStrs));
        }
      } else if (preset === '9to5') {
        nextDayDates.add(day.date);
        const nineToFive = availableHourStrs.filter(h => {
          const hh = parseInt(h);
          return hh >= 9 && hh < 17;
        });
        if (nineToFive.length > 0) {
          nextHours.set(day.date, new Set(nineToFive));
        }
      }
    }
    setSelectedDayDates(nextDayDates);
    setSelectedHours(nextHours);
  };

  const availByWeekday = (() => {
    const map = new Map<number, DayAvailability[]>();
    for (const day of availability) {
      const list = map.get(day.day_of_week) || [];
      list.push(day);
      map.set(day.day_of_week, list);
    }
    return map;
  })();

  const weekdaySelectionState = (dow: number): 'none' | 'partial' | 'all' => {
    const days = availByWeekday.get(dow) || [];
    const withAvail = days.filter(d => d.available_windows.length > 0);
    if (withAvail.length === 0) return 'none';
    const selectedCount = withAvail.filter(d => selectedDayDates.has(d.date)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === withAvail.length) return 'all';
    return 'partial';
  };

  const toggleWeekday = (dow: number) => {
    const days = availByWeekday.get(dow) || [];
    const withAvail = days.filter(d => d.available_windows.length > 0);
    if (withAvail.length === 0) return;
    const next = new Set(selectedDayDates);
    const nextHours = new Map(selectedHours);
    const state = weekdaySelectionState(dow);
    if (state === 'all') {
      for (const d of withAvail) { next.delete(d.date); nextHours.delete(d.date); }
    } else {
      for (const d of withAvail) { next.add(d.date); }
    }
    setSelectedDayDates(next);
    setSelectedHours(nextHours);
  };

  const _goToStep3 = () => {
    if (selectedDayDates.size === 0) { setError(t('selectAtLeastOneDay')); return; }
    const initHours = new Map<string, Set<string>>(selectedHours);
    selectedDayDates.forEach(dateKey => { if (!initHours.has(dateKey)) initHours.set(dateKey, new Set()); });
    for (const key of initHours.keys()) { if (!selectedDayDates.has(key)) initHours.delete(key); }
    setSelectedHours(initHours);
    setError('');
    setStep(3);
  };

  function isHourAvailableOnDate(day: DayAvailability, hour: string): boolean {
    const daySlots = generateHourSlots(day);
    const slot = daySlots.find(s => s.hour === hour);
    return slot ? slot.available : false;
  }

  const toggleWeekdaySegment = (dow: number, segmentHours: string[]) => {
    const daysOfWeekday = (availByWeekday.get(dow) || []).filter(d => selectedDayDates.has(d.date));
    if (daysOfWeekday.length === 0) return;

    const isSelected = daysOfWeekday.every(d => {
      const h = selectedHours.get(d.date);
      return segmentHours.every(sh => h?.has(sh));
    });

    const nextMap = new Map(selectedHours);
    for (const day of daysOfWeekday) {
      const daySet = new Set(nextMap.get(day.date) || []);
      for (const sh of segmentHours) {
        if (isSelected) daySet.delete(sh);
        else if (isHourAvailableOnDate(day, sh)) daySet.add(sh);
      }
      nextMap.set(day.date, daySet);
    }
    setSelectedHours(nextMap);
  };

  function getWeekdaySegments(dow: number) {
    const dates = (availByWeekday.get(dow) || []).filter(d => selectedDayDates.has(d.date));
    if (dates.length === 0) return [];
    const firstDay = dates[0];
    if (!firstDay.operating_hours) return [];
    const segments = getClippedSegments(firstDay.operating_hours);

    return segments.map(seg => {
      const allLocked = seg.hours.every(hour => {
        return dates.every(d => !isHourAvailableOnDate(d, hour));
      });

      const isSelected = !allLocked && dates.every(d => {
        const h = selectedHours.get(d.date);
        return seg.hours.every(sh => {
          if (!isHourAvailableOnDate(d, sh)) return true;
          return h?.has(sh) ?? false;
        });
      });

      return { ...seg, locked: allLocked, selected: isSelected };
    });
  }

  const translatedDayNames: string[] = t('dayNames', { ns: 'common', returnObjects: true }) as string[];

  const hoursMissingDays: string[] = (() => {
    const missing: string[] = [];
    for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
      const dates = (availByWeekday.get(dow) || []).filter(d => selectedDayDates.has(d.date));
      if (dates.length === 0) continue;
      const hasAnyHour = dates.some(d => { const h = selectedHours.get(d.date); return h && h.size > 0; });
      if (!hasAnyHour) missing.push(translatedDayNames[dow]);
    }
    return missing;
  })();

  const _goToStep4 = () => { if (hoursMissingDays.length > 0) return; setError(''); setStep(4); };

  function getTimeRangesForDay(dateKey: string): { start_time: string; end_time: string }[] {
    const hours = selectedHours.get(dateKey);
    if (!hours || hours.size === 0) return [];
    const sorted = Array.from(hours).sort();

    const ranges: { start_time: string; end_time: string }[] = [];
    let rangeStart = sorted[0];
    let rangeEnd = `${String(parseInt(sorted[0]) + 1).padStart(2, '0')}:00`;
    for (let i = 1; i < sorted.length; i++) {
      const curH = parseInt(sorted[i]);
      if (curH === parseInt(sorted[i - 1]) + 1) {
        rangeEnd = `${String(curH + 1).padStart(2, '0')}:00`;
      } else {
        ranges.push({ start_time: rangeStart, end_time: rangeEnd });
        rangeStart = sorted[i];
        rangeEnd = `${String(curH + 1).padStart(2, '0')}:00`;
      }
    }
    ranges.push({ start_time: rangeStart, end_time: rangeEnd });
    return ranges;
  }

  /** Convert SelectedDay[] into flat hourly ScheduleSlot[] for schedule-based compatibility check */
  function selectedDaysToScheduleSlots(days: SelectedDay[]): ScheduleSlot[] {
    const slots: ScheduleSlot[] = [];
    for (const day of days) {
      for (const range of day.time_ranges) {
        // Expand each time range into hourly slots
        const startH = parseInt(range.start_time.slice(0, 2));
        const endH = parseInt(range.end_time.slice(0, 2));
        for (let h = startH; h < endH; h++) {
          slots.push({
            date: day.date,
            start_time: `${String(h).padStart(2, '0')}:00:00`,
            end_time: `${String(h + 1).padStart(2, '0')}:00:00`,
          });
        }
      }
    }
    return slots;
  }

  /** Convert compat available_slots to SelectedDay[] format */
  function convertSlotsToSelectedDays(slots: { date: string; start_time: string; end_time: string }[]): SelectedDay[] {
    const byDate = new Map<string, { start_time: string; end_time: string }[]>();
    for (const s of slots) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date)!.push({ start_time: s.start_time, end_time: s.end_time });
    }
    const selectedDays: SelectedDay[] = [];
    for (const [date, dateSlots] of byDate) {
      dateSlots.sort((a, b) => a.start_time.localeCompare(b.start_time));
      const ranges: { start_time: string; end_time: string }[] = [];
      let cur = { ...dateSlots[0] };
      for (let i = 1; i < dateSlots.length; i++) {
        if (dateSlots[i].start_time === cur.end_time) cur.end_time = dateSlots[i].end_time;
        else { ranges.push(cur); cur = { ...dateSlots[i] }; }
      }
      ranges.push(cur);
      selectedDays.push({ date, time_ranges: ranges });
    }
    return selectedDays;
  }

  // ─── Submit handler ───
  const handleSubmit = async (e?: FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    try {
      {
        // Long-term submit
        const days: SelectedDay[] = [];
        selectedHours.forEach((hours, dateKey) => {
          if (hours.size > 0) {
            days.push({ date: dateKey, time_ranges: getTimeRangesForDay(dateKey) });
          }
        });

        if (isEditMode && editOrderId) {
          await editOrder(Number(editOrderId), {
            start_date: startDate,
            end_date: endDate,
            selected_days: days,
            notes: notes || undefined,
          });
          for (let i = 0; i < creativeFiles.length; i++) {
            setUploadProgress(prev => new Map(prev).set(i, 0));
            await uploadCreative(Number(editOrderId), creativeFiles[i], (pct) => setUploadProgress(prev => new Map(prev).set(i, pct)));
          }
          setUploadProgress(new Map());
          setOrderId(editOrderId);
        } else {
          // Defer order creation — store data for later.
          // The order will be created when the user either skips (single order)
          // or creates a campaign (order with campaign_id).
          const orderData: OrderCreateData = {
            space_id: Number(id),
            booking_type: 'long_term',
            start_date: startDate,
            end_date: endDate,
            selected_days: days,
            notes: notes || undefined,
          };
          pendingOrderDataRef.current = orderData;
          pendingScheduleSlotsRef.current = selectedDaysToScheduleSlots(days);
        }
      }
      if (isEditMode) {
        if (isCampaignEdit && childOrderIds.length > 0) {
          // Campaign edit: check compatibility of new schedule with each child's space
          try {
            const childDetails = await Promise.all(childOrderIds.map(cid => getOrderDetail(cid)));
            const targets: CampaignCompatibilityTarget[] = childDetails.map(child => ({
              target_space_id: child.space_id,
              exclude_order_id: child.id,
            }));
            const results = await checkCampaignCompatibility(Number(editOrderId), targets);
            const enriched = results.map((r, i) => ({
              ...r,
              childId: childDetails[i].id,
              spaceTitle: r.target_space_name,
            }));
            setCampaignEditResults(enriched);
            // Pre-select children with full or partial compatibility
            const preSelected = new Set<number>();
            for (const r of enriched) {
              if (r.compatibility === 'full' || r.compatibility === 'partial') {
                preSelected.add(r.childId);
              }
            }
            setCampaignEditSelected(preSelected);
            setStep(4);
          } catch {
            // If campaign compat fails, just go to success
            setSuccess(true);
            setStep(5);
          }
        } else {
          setSuccess(true);
          setStep(5);
        }
      } else {
        const allCampaignIds = [...campaignSpaceIds, ...campaignExtraSpaceIds];
        if (isCampaignCreate && allCampaignIds.length > 0) {
          // Determine which spaces actually have availability (exclude the primary space — it's added separately)
          const otherSpaceIds = allCampaignIds.filter(sid => sid !== Number(id) && !campaignRemovedSpaces.has(sid));
          const viableSpaces = otherSpaceIds.filter(sid => {
            const c = campaignPerSpaceCompat[sid];
            return c && c !== 'loading' && c !== 'error' && c.compatibility !== 'none';
          });

          // GUARD: Only block if there ARE other spaces but none have availability
          if (otherSpaceIds.length > 0 && viableSpaces.length === 0) {
            setError(t('noSpacesFullAvailability'));
            setLoading(false);
            return;
          }

          // Create campaign, then book each space — skip any that fail (fully booked)
          const templateSlots = pendingScheduleSlotsRef.current || [];
          const campaign = await createCampaign({ campaign_type: bookingType, schedule_template: templateSlots.length > 0 ? { slots: templateSlots } : undefined });
          const campaignId = campaign.id;
          let firstOrderId: number | null = null;
          const created: { spaceTitle: string; ref: string; cost: number; hours: number; compatibility: string; image?: string; city?: string }[] = [];
          const primaryData = pendingOrderDataRef.current!;

          // Primary space — use compat-validated slots when available (preferenceMode may include booked hours)
          const primaryCompatData = campaignPerSpaceCompat[Number(id)];
          const primaryValidSlots = primaryCompatData && primaryCompatData !== 'loading' && primaryCompatData !== 'error' && primaryCompatData.compatibility !== 'none'
            ? convertSlotsToSelectedDays((primaryCompatData as CompatibilityResult).available_slots)
            : null;
          try {
            const primaryOrder = await createOrder({
              ...primaryData,
              ...(primaryValidSlots ? { selected_days: primaryValidSlots } : {}),
              campaign_id: campaignId,
            });
            firstOrderId = primaryOrder.id;
            setOrderId(primaryOrder.reference_number);
            for (let i = 0; i < creativeFiles.length; i++) {
              setUploadProgress(prev => new Map(prev).set(i, 0));
              await uploadCreative(primaryOrder.id, creativeFiles[i], (pct) => setUploadProgress(prev => new Map(prev).set(i, pct)));
            }
            setUploadProgress(new Map());
            const primaryCompatRes = primaryCompatData && primaryCompatData !== 'loading' && primaryCompatData !== 'error' ? primaryCompatData as CompatibilityResult : null;
            created.push({
              spaceTitle: space.name,
              ref: primaryOrder.reference_number,
              cost: primaryOrder.total_cost,
              hours: primaryCompatRes ? primaryCompatRes.available_count : totalHours,
              compatibility: primaryCompatRes ? primaryCompatRes.compatibility : 'full',
              image: space.images?.[0]?.image_url || undefined,
              city: space.city || undefined,
            });
          } catch {
            console.warn(`Skipping primary space ${id}: fully booked or unavailable`);
          }

          // Other spaces
          for (const sid of viableSpaces) {
            const c = campaignPerSpaceCompat[sid] as CompatibilityResult;
            const selectedDays = convertSlotsToSelectedDays(c.available_slots);

            try {
              const order = await createOrder({
                space_id: sid,
                booking_type: 'long_term',
                start_date: primaryData.start_date,
                end_date: primaryData.end_date,
                selected_days: selectedDays,
                notes: notes || undefined,
                campaign_id: campaignId,
              });

              if (firstOrderId) {
                // Duplicate creatives from the first successful order
                try { await duplicateCreatives(order.id, firstOrderId); } catch { /* non-critical */ }
              } else {
                // Primary space failed — upload creatives directly to this first successful order
                for (let i = 0; i < creativeFiles.length; i++) {
                  setUploadProgress(prev => new Map(prev).set(i, 0));
                  await uploadCreative(order.id, creativeFiles[i], (pct) => setUploadProgress(prev => new Map(prev).set(i, pct)));
                }
                setUploadProgress(new Map());
              }

              const spaceInfo = campaignSpaces.find(sp => sp.id === sid);
              created.push({
                spaceTitle: spaceInfo?.name || c.target_space_name,
                ref: order.reference_number,
                cost: order.total_cost,
                hours: c.available_count,
                compatibility: c.compatibility,
                image: spaceInfo?.first_image || undefined,
                city: spaceInfo?.city || undefined,
              });
              if (!firstOrderId) firstOrderId = order.id;
            } catch {
              console.warn(`Skipping space ${sid}: fully booked or unavailable`);
            }
          }

          try { await finalizeCampaign(campaignId); } catch { /* non-critical */ }
          setCampaignCreated(created);
          setSuccess(true);
          setStep(5);
          goToWizardStep(5);
        } else {
          // Non-campaign or single space: regular flow
          setStep(4);
          setCampaignReview(isCampaignCreate);
          loadCampaignSpaces();
        }
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (detail?.message ?? null);
      setError(typeof msg === 'string' ? msg : (isEditMode ? t('updateFailed') : t('bookingFailed')));
    } finally {
      setLoading(false);
    }
  };

  const loadCampaignSpaces = async (): Promise<void> => {
    try {
      const allSpaces = await getSpaces();
      const otherSpaces = isCampaignCreate
        ? allSpaces.filter(s => campaignSpaceIds.includes(s.id))
        : allSpaces.filter(s => s.id !== Number(id));
      setCampaignSpaces(otherSpaces);

      if (isCampaignCreate) {
        setCampaignSelected(new Set(otherSpaces.map(s => s.id)));
      }

      if (otherSpaces.length === 0) return;

      // Check compatibility for each space in parallel
      const initial: Record<number, 'loading'> = {};
      for (const s of otherSpaces) initial[s.id] = 'loading';
      setCampaignCompat(initial);

      const compatPromises: Promise<void>[] = [];

      if (pendingScheduleSlotsRef.current.length > 0) {
        const slots = pendingScheduleSlotsRef.current;
        otherSpaces.forEach(s => {
          compatPromises.push(
            checkScheduleCompatibility(slots, s.id)
              .then(result => setCampaignCompat(prev => ({ ...prev, [s.id]: result })))
              .catch(() => setCampaignCompat(prev => ({ ...prev, [s.id]: 'error' })))
          );
        });
      } else {
        const oid = createdOrderIdRef.current;
        if (!oid) return;
        otherSpaces.forEach(s => {
          compatPromises.push(
            checkCompatibility(oid, s.id)
              .then(result => setCampaignCompat(prev => ({ ...prev, [s.id]: result })))
              .catch(() => setCampaignCompat(prev => ({ ...prev, [s.id]: 'error' })))
          );
        });
      }

      await Promise.all(compatPromises);
    } catch {
      // If spaces fail to load, just go to success
      setSuccess(true);
      setStep(5);
    }
  };

  const loadCampaignExtraSpaces = async () => {
    try {
      // Save current campaign spaces before overwriting for the sheet
      savedCampaignSpacesRef.current = campaignSpaces;
      // Clean up: remove previously-removed extras so they show in the sheet again
      const activeExtras = campaignExtraSpaceIds.filter(sid => !campaignRemovedSpaces.has(sid));
      setCampaignExtraSpaceIds(activeExtras);
      const allSpaces = await getSpaces();
      const existingIds = new Set([...campaignSpaceIds.filter(sid => !campaignRemovedSpaces.has(sid)), ...activeExtras, Number(id)]);
      const otherSpaces = allSpaces.filter(s => !existingIds.has(s.id));
      setCampaignSpaces(otherSpaces);
      setCampaignSelected(new Set());

      // Check compatibility for each space in parallel
      const initial: Record<number, 'loading'> = {};
      for (const s of otherSpaces) initial[s.id] = 'loading';
      setCampaignCompat(initial);

      // Build schedule slots from current selection
      const days: SelectedDay[] = [];
      selectedHours.forEach((hours, dateKey) => {
        if (hours.size > 0) {
          days.push({ date: dateKey, time_ranges: getTimeRangesForDay(dateKey) });
        }
      });
      const slots = selectedDaysToScheduleSlots(days);

      if (slots.length > 0) {
        otherSpaces.forEach(s => {
          checkScheduleCompatibility(slots, s.id)
            .then(result => setCampaignCompat(prev => ({ ...prev, [s.id]: result })))
            .catch(() => setCampaignCompat(prev => ({ ...prev, [s.id]: 'error' })));
        });
      }
    } catch {
      // silently fail
    }
  };

  const toggleCampaignSpace = (spaceId: number) => {
    setCampaignSelected(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  };

  const handleCreateCampaign = async () => {
    setCampaignCreating(true);
    setError('');
    const created: { spaceTitle: string; ref: string; cost: number; hours: number; compatibility: string; image?: string; city?: string }[] = [];

    try {
      // 1. Create campaign entity (include schedule template from user's full preference)
      const tmplDays: SelectedDay[] = [];
      selectedHours.forEach((hours, dateKey) => {
        if (hours.size > 0) tmplDays.push({ date: dateKey, time_ranges: getTimeRangesForDay(dateKey) });
      });
      const tmplSlots = selectedDaysToScheduleSlots(tmplDays);
      const campaign = await createCampaign({ campaign_type: bookingType, schedule_template: tmplSlots.length > 0 ? { slots: tmplSlots } : undefined });
      const campaignId = campaign.id;

      // 2. Create the reference order with campaign_id
      let oid = createdOrderIdRef.current;
      if (!oid && pendingOrderDataRef.current) {
        // Deferred creation: create the reference order now with campaign_id
        const refOrder = await createOrder({
          ...pendingOrderDataRef.current,
          campaign_id: campaignId,
        });
        oid = refOrder.id;
        createdOrderIdRef.current = oid;
        setOrderId(refOrder.reference_number);
        // Upload creative to the reference order
        for (let i = 0; i < creativeFiles.length; i++) {
          setUploadProgress(prev => new Map(prev).set(i, 0));
          await uploadCreative(oid, creativeFiles[i], (pct) => setUploadProgress(prev => new Map(prev).set(i, pct)));
        }
        setUploadProgress(new Map());
      } else if (oid) {
        // Fallback: order already exists (e.g. edit flow), assign campaign
        await setOrderCampaign(oid, campaignId);
      }

      if (!oid) {
        setError(t('failedToCreateCampaign'));
        setCampaignCreating(false);
        return;
      }

      // Add the primary/reference space to the created list
      created.push({
        spaceTitle: space.name,
        ref: orderId || '',
        cost: totalCost,
        hours: totalHours,
        compatibility: 'full',
        image: space.images?.[0]?.image_url || undefined,
        city: space.city || undefined,
      });

      // 3. Create child orders with campaign_id
      for (const spaceId of campaignSelected) {
        const compat = campaignCompat[spaceId];
        if (!compat || compat === 'loading' || compat === 'error' || compat.compatibility === 'none') continue;

        const selectedDays = convertSlotsToSelectedDays(compat.available_slots);
        const dates = compat.available_slots.map(s => s.date).sort();
        const data: OrderCreateData = {
          space_id: spaceId,
          booking_type: bookingType,
          start_date: dates[0],
          end_date: dates[dates.length - 1],
          selected_days: selectedDays,
          notes: notes || undefined,
          campaign_id: campaignId,
        };

        try {
          const newOrder = await createOrder(data);
          try { await duplicateCreatives(newOrder.id, oid); } catch { /* non-critical */ }
          const spaceInfo = campaignSpaces.find(sp => sp.id === spaceId);
          created.push({
            spaceTitle: spaceInfo?.name || compat.target_space_name,
            ref: newOrder.reference_number,
            cost: newOrder.total_cost,
            hours: compat.available_count,
            compatibility: compat.compatibility,
            image: spaceInfo?.first_image || undefined,
            city: spaceInfo?.city || undefined,
          });
        } catch {
          // Skip failed ones silently
        }
      }

      // Send one consolidated email for the entire campaign
      try { await finalizeCampaign(campaignId); } catch { /* non-critical */ }
    } catch {
      setError(t('failedToCreateCampaign'));
    }

    setCampaignCreated(created);
    setCampaignCreating(false);
    setSuccess(true);
    setStep(5);
    goToWizardStep(5);
  };

  const skipCampaign = async () => {
    setLoading(true);
    setError('');
    try {
      const days: SelectedDay[] = [];
      selectedHours.forEach((hours, dateKey) => {
        if (hours.size > 0) {
          days.push({ date: dateKey, time_ranges: getTimeRangesForDay(dateKey) });
        }
      });

      if (isEditMode && editOrderId) {
        // Edit the existing order — don't create a new one
        await editOrder(Number(editOrderId), {
          booking_type: 'long_term',
          start_date: startDate,
          end_date: endDate,
          selected_days: days,
          notes: notes || undefined,
        });
        for (let i = 0; i < creativeFiles.length; i++) {
          setUploadProgress(prev => new Map(prev).set(i, 0));
          await uploadCreative(Number(editOrderId), creativeFiles[i], (pct) => setUploadProgress(prev => new Map(prev).set(i, pct)));
        }
        setUploadProgress(new Map());
        setOrderId(editOrderId);
      } else {
        // Build order data from current state if not already deferred
        if (!pendingOrderDataRef.current && !createdOrderIdRef.current) {
          pendingOrderDataRef.current = {
            space_id: Number(id),
            booking_type: 'long_term',
            start_date: startDate,
            end_date: endDate,
            selected_days: days,
            notes: notes || undefined,
          };
        }
        // Create the single order now (no campaign)
        if (!createdOrderIdRef.current && pendingOrderDataRef.current) {
          const order = await createOrder(pendingOrderDataRef.current);
          createdOrderIdRef.current = order.id;
          setOrderId(order.reference_number);
          for (let i = 0; i < creativeFiles.length; i++) {
            setUploadProgress(prev => new Map(prev).set(i, 0));
            await uploadCreative(order.id, creativeFiles[i], (pct) => setUploadProgress(prev => new Map(prev).set(i, pct)));
          }
          setUploadProgress(new Map());
        }
      }
      setSuccess(true);
      setStep(5);
      goToWizardStep(5);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (detail?.message ?? null);
      setError(typeof msg === 'string' ? msg : (isEditMode ? t('updateFailed') : t('bookingFailed')));
    } finally {
      setLoading(false);
    }
  };

  // Campaign filter options — must be before any early return (hooks rules)
  const campaignCategoryOptions = useMemo(() => {
    const types = new Set(campaignSpaces.map(s => s.space_type?.name).filter(Boolean));
    return [{ value: 'all', label: t('allSpaceTypes', { ns: 'common' }) }, ...Array.from(types).sort().map(tp => ({ value: tp!, label: tp! }))];
  }, [campaignSpaces, t]);
  const campaignPriceOptions = useMemo(() => PRICE_RANGES.map((r, i) => ({ value: i, label: t(r.labelKey, { ns: 'common' }) })), [t]);

  if (!space) {
    return (
      <div className="bf-loading">
        <Loader variant="page" />
      </div>
    );
  }

  // ─── Compute totals (prorated daily rate) ───
  let totalHours = 0;
  let totalDays = 0;
  let totalCost = 0;

  // Build a lookup: date → bookable whole-hour slots for that day.
  // ceil(start) and floor(end) so "all day" selection = price_per_day exactly.
  const opHoursByDate = new Map<string, number>();
  for (const day of availability) {
    if (day.operating_hours) {
      const startH = Math.ceil(parseTimeDecimal(day.operating_hours.start_time));
      const endH = Math.floor(parseTimeDecimal(day.operating_hours.end_time));
      opHoursByDate.set(day.date, Math.max(endH - startH, 1));
    }
  }

  selectedHours.forEach((hours, dateKey) => {
    const count = hours.size;
    totalHours += count;
    const dayOpHours = opHoursByDate.get(dateKey) || count || 1;
    totalCost += (space.price_per_day / dayOpHours) * count;
  });
  // Only count days that actually have hours selected
  totalDays = Array.from(selectedDayDates).filter(date => {
    const hours = selectedHours.get(date);
    return hours && hours.size > 0;
  }).length;

  // Duplicate-to-another-space selected breakdown (non-campaign single-space flow)
  const dupAvailableSelected = !isCampaignCreate ? Array.from(campaignSelected).filter(sid => {
    const c = campaignCompat[sid];
    return c && c !== 'loading' && c !== 'error' && c.compatibility !== 'none';
  }) : [];
  const dupSelectedCount = dupAvailableSelected.length;
  const dupSelectedCost = dupAvailableSelected.reduce((sum, sid) => {
    const c = campaignCompat[sid];
    if (c && c !== 'loading' && c !== 'error') return sum + c.estimated_cost;
    return sum;
  }, 0);
  const dupCombinedTotal = totalCost + dupSelectedCost;

  // Per-space compat loading state
  const campaignPerSpaceCompatLoading = Object.values(campaignPerSpaceCompat).some(v => v === 'loading');
  const campaignPerSpaceCompatLoaded = Object.keys(campaignPerSpaceCompat).length > 0 && !campaignPerSpaceCompatLoading;

  // Per-space breakdown: actual hours/cost per space (or estimated if compat not loaded yet)
  const allCampaignSpaceIds = [...campaignSpaceIds, ...campaignExtraSpaceIds];
  const campaignSpaceBreakdown: { spaceId: number; name: string; hours: number; cost: number; status: string }[] | null = (() => {
    if (!isCampaignCreate || allCampaignSpaceIds.length === 0) return null;

    const entries: { spaceId: number; name: string; hours: number; cost: number; status: string }[] = [];

    if (campaignPerSpaceCompatLoaded) {
      // Use actual per-space results
      for (const sid of allCampaignSpaceIds) {
        if (campaignRemovedSpaces.has(sid)) continue;
        const c = campaignPerSpaceCompat[sid];
        const spaceInfo = campaignSpaces.find(s => s.id === sid);
        if (c && c !== 'loading' && c !== 'error') {
          entries.push({
            spaceId: sid,
            name: spaceInfo?.name || c.target_space_name || '',
            hours: c.available_count,
            cost: c.estimated_cost,
            status: c.compatibility,
          });
        } else {
          entries.push({
            spaceId: sid,
            name: spaceInfo?.name || '',
            hours: 0,
            cost: 0,
            status: c === 'error' ? 'error' : 'none',
          });
        }
      }
    } else {
      // Estimated: prorate other spaces using the same hour ratio as primary space
      const prorateRatio = space.price_per_day > 0 ? totalCost / space.price_per_day : 0;
      for (const s of campaignSpaces) {
        entries.push({
          spaceId: s.id,
          name: s.name,
          hours: totalHours,
          cost: prorateRatio * s.price_per_day,
          status: 'estimated',
        });
      }
    }

    return entries;
  })();

  // Campaign total: use actual per-space costs when available, otherwise estimate (exclude unavailable)
  const primaryId = Number(id);
  const campaignEstimatedCost = campaignSpaceBreakdown
    ? (() => {
        const primaryInBreakdown = campaignSpaceBreakdown.find(e => e.spaceId === primaryId);
        const primaryCostVal = primaryInBreakdown && primaryInBreakdown.status !== 'none' && primaryInBreakdown.status !== 'error'
          ? primaryInBreakdown.cost : totalCost;
        const othersCost = campaignSpaceBreakdown
          .filter(e => e.spaceId !== primaryId && e.status !== 'none' && e.status !== 'error')
          .reduce((sum, e) => sum + e.cost, 0);
        return primaryCostVal + othersCost;
      })()
    : totalCost;

  // ─── Step 4: Campaign Edit — compatibility review ───
  if (step === 4 && isCampaignEdit && !success) {
    const handleCampaignEditApply = async () => {
      setCampaignEditApplying(true);
      const done: { childId: number; spaceTitle: string; success: boolean; ref?: string; error?: string }[] = [];

      for (const result of campaignEditResults) {
        if (!campaignEditSelected.has(result.childId)) continue;

        // Convert available_slots to SelectedDay[]
        const byDate = new Map<string, { start_time: string; end_time: string }[]>();
        for (const s of result.available_slots) {
          if (!byDate.has(s.date)) byDate.set(s.date, []);
          byDate.get(s.date)!.push({ start_time: s.start_time, end_time: s.end_time });
        }
        const selectedDays: SelectedDay[] = [];
        for (const [date, slots] of byDate) {
          slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
          const ranges: { start_time: string; end_time: string }[] = [];
          let cur = { ...slots[0] };
          for (let i = 1; i < slots.length; i++) {
            if (slots[i].start_time === cur.end_time) cur.end_time = slots[i].end_time;
            else { ranges.push(cur); cur = { ...slots[i] }; }
          }
          ranges.push(cur);
          selectedDays.push({ date, time_ranges: ranges });
        }

        const dates = result.available_slots.map(s => s.date).sort();
        try {
          const updated = await editOrder(result.childId, {
            start_date: dates[0],
            end_date: dates[dates.length - 1],
            selected_days: selectedDays,
          });
          done.push({ childId: result.childId, spaceTitle: result.spaceTitle, success: true, ref: updated.reference_number });
        } catch (err: any) {
          done.push({ childId: result.childId, spaceTitle: result.spaceTitle, success: false, error: err.response?.data?.detail || t('updateFailed') });
        }
      }

      setCampaignEditDone(done);
      setCampaignEditApplying(false);
      setSuccess(true);
      setStep(5);
    };

    const selectedEditCount = campaignEditSelected.size;
    const hasSelectableChildren = campaignEditResults.some(r => r.compatibility !== 'none');

    return (
      <div className="bf-page">
        <div className="bf-campaign-step">
          <div className="bf-campaign-header">
            <div className="bf-campaign-check-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h2>{t('scheduleUpdated')}</h2>
            <p className="bf-campaign-subtitle">{t('reviewCampaignOrders')}</p>
          </div>

          <div className="bf-campaign-scroll">
            <div className="bf-campaign-edit-results">
              {campaignEditResults.map(result => {
                const isNone = result.compatibility === 'none';
                const isFull = result.compatibility === 'full';
                const isPartial = result.compatibility === 'partial';
                const isSelected = campaignEditSelected.has(result.childId);
                const disabled = isNone;

                return (
                  <button
                    key={result.childId}
                    className={`bf-campaign-edit-card${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                    onClick={() => {
                      if (disabled) return;
                      setCampaignEditSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(result.childId)) next.delete(result.childId);
                        else next.add(result.childId);
                        return next;
                      });
                    }}
                    disabled={disabled}
                  >
                    {isSelected && (
                      <span className="bf-campaign-card-check">
                        <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                    )}
                    <div className="bf-campaign-card-body">
                      <span className="bf-campaign-card-name">{result.spaceTitle}</span>
                      {isFull && <span className="bf-campaign-card-badge bf-badge-full">{t('fullyCompatible')}</span>}
                      {isPartial && (
                        <span className="bf-campaign-card-badge bf-badge-partial">
                          {t('hoursCount', { available: result.available_count, total: result.total_source_slots })}
                        </span>
                      )}
                      {isNone && <span className="bf-campaign-card-badge bf-badge-none">{t('notAvailable')}</span>}
                      {isPartial && result.conflicts.length > 0 && (
                        <div className="bf-campaign-edit-conflicts">
                          {result.conflicts.slice(0, 3).map((c, i) => (
                            <span key={i}>{c.date} {c.start_time.slice(0, 5)}-{c.end_time.slice(0, 5)}: {c.reason === 'capacity_full' ? t('conflictFull') : t('conflictOutsideHours')}</span>
                          ))}
                          {result.conflicts.length > 3 && <span>{t('moreConflicts', { count: result.conflicts.length - 3 })}</span>}
                        </div>
                      )}
                      {!isNone && (
                        <span className="bf-campaign-card-price">&#8362;{result.estimated_cost.toFixed(2)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bf-campaign-bottom">
            <button className="bf-btn bf-btn-ghost" onClick={() => { setSuccess(true); setStep(5); }}>
              {t('skip')}
            </button>
            <button
              className="bf-btn bf-btn-primary"
              onClick={handleCampaignEditApply}
              disabled={campaignEditApplying || selectedEditCount === 0 || !hasSelectableChildren}
            >
              {campaignEditApplying
                ? t('applying')
                : t('applyToSpaces', { count: selectedEditCount })
              }
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 4: Add More Spaces + Review ───
  if (step === 4 && !success) {
    const filteredCampaignSpaces = campaignSpaces.filter(s => {
      const q = campaignSearch.toLowerCase().trim();
      if (q && !s.name.toLowerCase().includes(q) && !(s.city || '').toLowerCase().includes(q)) return false;
      if (campaignCategory !== 'all' && s.space_type?.name !== campaignCategory) return false;
      const range = PRICE_RANGES[campaignPriceIdx];
      if (s.price_per_day < range.min || s.price_per_day > range.max) return false;
      return true;
    });

    const sortedSpaces = [...filteredCampaignSpaces].sort((a, b) => {
      const order = (sid: number) => {
        const c = campaignCompat[sid];
        if (!c || c === 'loading' || c === 'error') return 3;
        if (c.compatibility === 'full') return 0;
        if (c.compatibility === 'partial') return 1;
        return 2;
      };
      return order(a.id) - order(b.id);
    });

    const stillLoading = Object.values(campaignCompat).some(c => c === 'loading');

    const availableSelected = Array.from(campaignSelected).filter(sid => {
      const c = campaignCompat[sid];
      return c && c !== 'loading' && c !== 'error' && c.compatibility !== 'none';
    });
    const selectedCount = availableSelected.length;
    const selectedCost = availableSelected.reduce((sum, sid) => {
      const c = campaignCompat[sid];
      if (c && c !== 'loading' && c !== 'error') return sum + (space.price_per_day > 0 ? totalCost / space.price_per_day : 0) * c.target_space_price_per_day;
      return sum;
    }, 0);

    // ─── Sub-view: Space Selection (for regular single-order flow) ───
    if (!campaignReview) {
      return (
        <div className="bf-page">
          <div className="bf-campaign-step">
            <div className="bf-campaign-header">
              <div className="bf-campaign-check-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <h2>{t('orderPlacedFor', { name: space.name })}</h2>
              <p className="bf-campaign-subtitle">{t('addMoreSpacesDesc')}</p>
            </div>

            <div className="bf-campaign-filters">
              <div className="filter-bar-search">
                <input
                  type="text"
                  className="filter-bar-search-input"
                  placeholder={t('searchSpaces', { ns: 'common' })}
                  value={campaignSearch}
                  onChange={e => setCampaignSearch(e.target.value)}
                />
                {campaignSearch && (
                  <button type="button" className="filter-bar-search-clear" onClick={() => setCampaignSearch('')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
                <span className="filter-bar-search-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                </span>
              </div>
              <div className="bf-campaign-filter-row">
                <FilterDropdown value={campaignCategory} options={campaignCategoryOptions} onChange={setCampaignCategory} />
                <FilterDropdown value={campaignPriceIdx} options={campaignPriceOptions} onChange={setCampaignPriceIdx} />
              </div>
            </div>

            <div className="bf-campaign-scroll">
              <div className="bf-campaign-grid">
                {sortedSpaces.map(s => {
                  const compat = campaignCompat[s.id];
                  const isLoading = compat === 'loading';
                  const isError = compat === 'error';
                  const result = (compat && compat !== 'loading' && compat !== 'error') ? compat : null;
                  const isNone = result?.compatibility === 'none';
                  const isFull = result?.compatibility === 'full';
                  const isPartial = result?.compatibility === 'partial';
                  const isSelected = campaignSelected.has(s.id);
                  const disabled = isLoading || isError || isNone;

                  return (
                    <button
                      key={s.id}
                      className={`bf-campaign-card${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                      onClick={() => !disabled && toggleCampaignSpace(s.id)}
                      disabled={disabled}
                    >
                      {isSelected && (
                        <span className="bf-campaign-card-overlay">
                          <svg viewBox="0 0 24 24" fill="none" width="32" height="32" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        </span>
                      )}
                      <div className="bf-campaign-card-img-wrap">
                        {s.first_image && (
                          <img className="bf-campaign-card-img" src={`${API_URL}${s.first_image}`} alt={s.name} />
                        )}
                      </div>
                      <div className="bf-campaign-card-body">
                        <span className="bf-campaign-card-name">{s.name}</span>
                        <span className="bf-campaign-card-meta">{[s.city, s.environment].filter(Boolean).join(' · ')}</span>
                        {isLoading && <span className="bf-campaign-card-badge bf-badge-loading">{t('checking')}</span>}
                        {isError && <span className="bf-campaign-card-badge bf-badge-none">{t('error')}</span>}
                        {isFull && <span className="bf-campaign-card-badge bf-badge-full">{t('fullyCompatible')}</span>}
                        {isPartial && (
                          <span className="bf-campaign-card-badge bf-badge-partial">
                            {t('hoursCount', { available: result!.available_count, total: result!.total_source_slots })}
                          </span>
                        )}
                        {isNone && <span className="bf-campaign-card-badge bf-badge-none">{t('notAvailable')}</span>}
                        {result && !isNone && (
                          <span className="bf-campaign-card-price">&#8362;{result.estimated_cost.toFixed(2)}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {campaignSpaces.length === 0 && (
                <div className="dup-loading">
                  <Loader variant="inline" />
                </div>
              )}
            </div>

            <div className="bf-campaign-bottom">
              <button className="bf-btn bf-btn-ghost" onClick={() => { setCampaignReview(true); }} disabled={loading || campaignCreating}>
                {t('skip')}
              </button>
              {selectedCount > 0 ? (
                <button
                  className="bf-btn bf-btn-primary"
                  onClick={() => setCampaignReview(true)}
                  disabled={stillLoading}
                >
                  {t('addSpacesButton', { count: selectedCount, cost: selectedCost.toFixed(2) })}
                </button>
              ) : (
                <button className="bf-btn bf-btn-primary" onClick={() => setCampaignReview(true)}>
                  {t('continue', { ns: 'common' })}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ─── Sub-view: Review & Confirm ───
    const hasCampaignSpaces = selectedCount > 0;
    const reviewAllSpaces = hasCampaignSpaces ? selectedCount + 1 : 1;
    const primaryImage = space.images?.[0]?.image_url || null;

    const primaryCompat = campaignPerSpaceCompat[Number(id)];
    const primaryCompatResult = primaryCompat && primaryCompat !== 'loading' && primaryCompat !== 'error' ? primaryCompat as CompatibilityResult : null;
    const reviewCards = [
      { image: primaryImage, name: space.name, city: space.city ? [space.city, space.full_address].filter(Boolean).join(', ') : '', hours: primaryCompatResult ? primaryCompatResult.available_count : totalHours, cost: primaryCompatResult ? primaryCompatResult.estimated_cost : totalCost },
      ...availableSelected.map(sid => {
        const c = campaignCompat[sid] as Exclude<typeof campaignCompat[number], 'loading' | 'error'>;
        const spaceInfo = campaignSpaces.find(sp => sp.id === sid);
        return {
          image: spaceInfo?.first_image || null,
          name: c.target_space_name,
          city: spaceInfo?.city || '',
          hours: c.available_count,
          cost: c.estimated_cost,
        };
      }),
    ];
    const reviewAllHours = reviewCards.reduce((sum, c) => sum + c.hours, 0);
    const reviewAllCost = reviewCards.reduce((sum, c) => sum + c.cost, 0);

    return (
      <div className="bf-page">
        <div className="bf-review-campaign">
          <div className="bf-review-campaign-header">
            <div className="bf-success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h1>{hasCampaignSpaces ? t('reviewYourCampaign') : t('reviewYourOrder')}</h1>
            <p className="bf-success-sub">
              {hasCampaignSpaces
                ? t('reviewCampaignDesc', { spaces: reviewAllSpaces, hours: reviewAllHours, cost: reviewAllCost.toFixed(2) })
                : t('reviewOrderDesc', { name: space.name })
              }
            </p>

          </div>

          {stillLoading ? (
            <div className="bf-review-campaign-scroll">
              <Loader variant="inline" />
            </div>
          ) : (
            <div className="bf-review-campaign-scroll">
              {/* ─── Space cards ─── */}
              <div className={`bf-done-cards${hasCampaignSpaces ? ' bf-done-cards-grid' : ''}`}>
                {reviewCards.map((card, i) => (
                  <div key={i} className="bf-done-card">
                    <div className="bf-done-card-img-wrap">
                      {card.image
                        ? <img className="bf-done-card-img" src={`${API_URL}${card.image}`} alt={card.name} />
                        : <div className="bf-done-card-img bf-done-card-img-placeholder" />
                      }
                    </div>
                    <div className="bf-done-card-body">
                      <div className="bf-done-card-info">
                        <span className="bf-done-card-name">{card.name}</span>
                        {card.city && <span className="bf-done-card-city">{card.city}</span>}
                        <div className="bf-done-card-details">
                          <svg className="bf-done-card-clock" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          <span className="bf-done-card-hours">{card.hours} {card.hours !== 1 ? t('hrs', { ns: 'common' }) : t('hr', { ns: 'common' })}</span>
                        </div>
                      </div>
                      <div className="bf-done-card-price">
                        <span className="bf-done-card-cost">&#8362;{card.cost.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Campaign total */}
              {hasCampaignSpaces && (
                <div className="bf-done-total">
                  <div className="bf-done-total-row">
                    <span>{t('campaignTotal')}</span>
                    <span>&#8362;{reviewAllCost.toFixed(2)}</span>
                  </div>
                  <div className="bf-done-total-sub">{t('campaignTotalSub', { spaces: reviewAllSpaces, hours: reviewAllHours })}</div>
                </div>
              )}
            </div>
          )}

          {/* Actions – sticky bottom */}
          <div className="bf-review-actions">
            <button className="bf-btn bf-btn-ghost" onClick={() => { setCampaignReview(false); setStep(3); }} disabled={loading || campaignCreating}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              {t('backToEdit')}
            </button>
            <div className="bf-review-actions-right">
              <div className="bf-bottom-cost">
                <span className="bf-bottom-cost-amount">&#8362;{reviewAllCost.toFixed(2)}</span>
                <span className="bf-bottom-cost-detail">{t('datesCount', { count: totalDays })}</span>
              </div>
              {hasCampaignSpaces ? (
                <button
                  className="bf-btn bf-btn-primary"
                  onClick={handleCreateCampaign}
                  disabled={campaignCreating || loading || stillLoading}
                >
                  {campaignCreating
                    ? t('creating')
                    : t('confirmCampaign')
                  }
                </button>
              ) : (
                <button className="bf-btn bf-btn-primary" onClick={skipCampaign} disabled={loading}>
                  {loading ? t('creating') : t('confirmOrder')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Success screen (early return for old step-4 / campaign-edit flows only) ───
  if (success && wizardStep !== 5) {
    // Campaign edit success
    if (isCampaignEdit) {
      const successCount = campaignEditDone.filter(d => d.success).length;
      const failCount = campaignEditDone.filter(d => !d.success).length;

      return (
        <div className="bf-page">
          <div className="bf-success bf-success-sticky">
            <div className="bf-success-header">
              <div className="bf-success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <h1>{t('campaignUpdated')}</h1>
              <p className="bf-success-sub">
                {t('orderForPrefix')} <strong>{space.name}</strong> {t('orderForSuffixUpdated')}
                {campaignEditDone.length > 0 && (
                  <> {t('ordersUpdatedCount', { success: successCount, fail: failCount })}</>
                )}
                {campaignEditDone.length === 0 && <> {t('noOtherOrdersModified')}</>}
              </p>
            </div>

            <div className="bf-success-scroll">
              <div className="bf-done-cards">
                <div className="bf-done-card">
                  <div className="bf-done-card-info">
                    <span className="bf-done-card-name">{space.name}</span>
                    <div className="bf-done-card-details">
                      <span className="bf-campaign-card-badge bf-badge-full">{t('updated')}</span>
                    </div>
                  </div>
                </div>

                {/* Child results */}
                {campaignEditDone.map((d, i) => (
                  <div key={i} className={`bf-done-card${d.success ? '' : ' bf-done-card-error'}`}>
                    <div className="bf-done-card-info">
                      <span className="bf-done-card-name">{d.spaceTitle}</span>
                      <div className="bf-done-card-details">
                        {d.success && <span className="bf-campaign-card-badge bf-badge-full">{t('updated')}</span>}
                        {!d.success && <span className="bf-campaign-card-badge bf-badge-none">{d.error}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bf-success-actions">
              <button className="bf-btn bf-btn-primary bf-btn-block" onClick={() => navigate('/orders')}>{t('viewMyOrders')}</button>
            </div>
          </div>
        </div>
      );
    }

    const hasCampaign = campaignCreated.length > 0;
    const allSpacesCount = hasCampaign ? campaignCreated.length : 1;
    const allHours = hasCampaign ? campaignCreated.reduce((s, c) => s + c.hours, 0) : totalHours;
    const allCost = hasCampaign ? campaignCreated.reduce((s, c) => s + c.cost, 0) : totalCost;
    const primaryImage = space.images?.[0]?.image_url || null;

    return (
      <div className="bf-page">
        <div className="bf-success bf-success-sticky">
          <div className="bf-success-header">
            <div className="bf-success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h1>{isEditMode ? t('orderUpdatedSuccess') : hasCampaign ? t('campaignCreated') : t('bookingConfirmed')}</h1>
            {hasCampaign && (
              <p className="bf-success-sub">{t('campaignSummary', { spaces: allSpacesCount, hours: allHours, cost: allCost.toFixed(2) })}</p>
            )}
            {!hasCampaign && (
              <p className="bf-success-sub">{t('bookingForPrefix')} <strong>{space.name}</strong> {isEditMode ? t('bookingForSuffixUpdated') : t('bookingForSuffixSubmitted')}</p>
            )}
          </div>

          <div className="bf-success-scroll">
            {/* ─── Space cards ─── */}
            <div className={`bf-done-cards${hasCampaign ? ' bf-done-cards-grid' : ''}`}>
              {(hasCampaign
                ? campaignCreated.map(c => ({ image: c.image || null, name: c.spaceTitle, city: c.city || '', hours: c.hours, cost: c.cost }))
                : [{ image: primaryImage, name: space.name, city: space.city ? [space.city, space.full_address].filter(Boolean).join(', ') : '', hours: totalHours, cost: totalCost }]
              ).map((card, i) => (
                <div key={i} className="bf-done-card">
                  <div className="bf-done-card-img-wrap">
                    {card.image
                      ? <img className="bf-done-card-img" src={`${API_URL}${card.image}`} alt={card.name} />
                      : <div className="bf-done-card-img bf-done-card-img-placeholder" />
                    }
                  </div>
                  <div className="bf-done-card-body">
                    <div className="bf-done-card-info">
                      <span className="bf-done-card-name">{card.name}</span>
                      {card.city && <span className="bf-done-card-city">{card.city}</span>}
                      <div className="bf-done-card-details">
                        <svg className="bf-done-card-clock" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span className="bf-done-card-hours">{card.hours} {card.hours !== 1 ? t('hrs', { ns: 'common' }) : t('hr', { ns: 'common' })}</span>
                      </div>
                    </div>
                    <div className="bf-done-card-price">
                      <span className="bf-done-card-cost">&#8362;{card.cost.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Campaign total bar */}
            {hasCampaign && (
              <div className="bf-done-total">
                <div className="bf-done-total-row">
                  <span>{t('campaignTotal')}</span>
                  <span>&#8362;{allCost.toFixed(2)}</span>
                </div>
                <div className="bf-done-total-sub">{t('campaignTotalSub', { spaces: allSpacesCount, hours: allHours })}</div>
              </div>
            )}
          </div>

          <div className="bf-success-actions">
            <button className="bf-btn bf-btn-primary bf-btn-block" onClick={() => navigate('/orders')}>{t('viewMyOrders')}</button>
          </div>
        </div>
      </div>
    );
  }

  // bookingType is always 'long_term'


  // ────────────────────────────────────────────────────────
  //  LONG-TERM FLOW — Progressive scroll single page
  // ────────────────────────────────────────────────────────
  const ltSteps = [
    { label: t('stepDates') },
    { label: t('stepSchedule') },
    { label: t('stepUpload') },
    { label: t('stepReview') },
    { label: t('stepConfirm') },
  ];


  // Validation gates for wizard navigation
  const canAdvanceStep1 = !!(startDate && endDate && availability.length > 0 && !ltLoadingAvailability);
  const canAdvanceStep2 = ltHasSchedule;
  const canAdvanceStep3 = creativeFiles.length > 0 || existingCreatives.length > 0;

  const primaryImage = space.images?.[0]?.image_url || null;

  return (
    <div className="bf-page bf-wizard-page">
      {/* Top navigation — back button only, no stepper circles */}
      <div className="bf-top-nav">
        {wizardStep < 5 && (
          <>
            <button className="bf-header-back" onClick={() => {
              if (wizardStep > 1) { goToWizardStep(wizardStep - 1); return; }
              if (isEditMode) { navigate('/orders'); return; }
              if (isCampaignCreate) { navigate('/create-campaign'); return; }
              navigate(`/location/${id}`);
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
            </button>
            {wizardStep <= 4 && (
              <span className="bf-top-nav-title">
                {wizardStep === 1 && (isEditMode ? t('changeCampaignDates') : t('campaignDuration'))}
                {wizardStep === 2 && t('setYourSchedule')}
                {wizardStep === 3 && t('uploadMedia')}
                {wizardStep === 4 && ((isCampaignCreate || dupSelectedCount > 0) ? t('reviewYourCampaign') : t('reviewYourOrder'))}
              </span>
            )}
          </>
        )}
      </div>

      {isEditMode && editCampaignId && (
        <div className="bf-edit-campaign-banner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#3b82f6" strokeWidth="1.5"/><path d="M8 5v3M8 10.5v.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/></svg>
          <span>{t('editingOrderFromCampaign', { id: editCampaignId })}</span>
          <span className="bf-edit-campaign-banner-sub">{t('changesApplyToThisSpace')}</span>
        </div>
      )}

      {/* ═══ WIZARD STEP 1 — Pick Dates ═══ */}
      {wizardStep === 1 && (
        <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
          <div className="bf-section bf-animate-in">
            {/* {!isCampaignCreate && (
              // <p className="bf-step-desc">{t('selectCampaignDatesDesc')}</p>
            )} */}

            {/* Quick date range picks — above calendar on desktop */}
            {!isEditMode && (
              <div className="bf-quick-picks">
                <span className="bf-quick-picks-label">{t('quickPick')}</span>
                <div className="bf-quick-picks-row">
                  {(() => {
                    const monthEndDate = addMonths(tomorrowDate, 1);
                    const monthStart = format(tomorrowDate, 'yyyy-MM-dd');
                    const monthEnd = format(monthEndDate, 'yyyy-MM-dd');
                    const isMonthActive = startDate === monthStart && endDate === monthEnd;

                    const halfYearEndDate = addMonths(tomorrowDate, 6);
                    const halfYearStart = format(tomorrowDate, 'yyyy-MM-dd');
                    const halfYearEnd = format(halfYearEndDate, 'yyyy-MM-dd');
                    const isHalfYearActive = startDate === halfYearStart && endDate === halfYearEnd;

                    const yearEndDate = addMonths(tomorrowDate, 12);
                    const yearStart = format(tomorrowDate, 'yyyy-MM-dd');
                    const yearEnd = format(yearEndDate, 'yyyy-MM-dd');
                    const isYearActive = startDate === yearStart && endDate === yearEnd;

                    const clearDates = () => { setStartDate(''); setEndDate(''); setActiveField(null); navigateCalendar(todayDate); };

                    const applyQuick = (s: string, e: string, endDateObj: Date) => {
                      setStartDate(s);
                      setEndDate(e);
                      setActiveField(null);
                      navigateCalendar(endDateObj);
                    };

                    return (
                      <>
                        <button type="button" className={`bf-quick-pick ${isMonthActive ? 'active' : ''}`} onClick={() => { if (isMonthActive) { clearDates(); } else { applyQuick(monthStart, monthEnd, monthEndDate); } }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                          {t('quickMonth')}
                        </button>
                        <button type="button" className={`bf-quick-pick ${isHalfYearActive ? 'active' : ''}`} onClick={() => { if (isHalfYearActive) { clearDates(); } else { applyQuick(halfYearStart, halfYearEnd, halfYearEndDate); } }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
                          {t('quickHalfYear')}
                        </button>
                        <button type="button" className={`bf-quick-pick ${isYearActive ? 'active' : ''}`} onClick={() => { if (isYearActive) { clearDates(); } else { applyQuick(yearStart, yearEnd, yearEndDate); } }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                          {t('quickYear')}
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="bf-date-card">
              <div className="bf-date-fields">
                <div
                  className={`bf-date-col bf-date-col-clickable${activeField === 'from' ? ' active' : ''}`}
                  onClick={() => {
                    const wasActive = activeField === 'from';
                    setActiveField(wasActive ? null : 'from');
                    if (!wasActive) navigateCalendar(todayDate);
                  }}
                >
                  <span className="bf-date-label">{t('start')}</span>
                  <span className={`bf-date-value ${startDate ? 'has-value' : ''}${activeField === 'from' ? ' picking' : ''}`}>
                    {activeField === 'from'
                      ? t('pickOnCalendar')
                      : startDate ? format(parse(startDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : t('select')}
                  </span>
                </div>
                <div className="bf-date-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </div>
                <div
                  className={`bf-date-col bf-date-col-clickable${activeField === 'to' ? ' active' : ''}`}
                  onClick={() => setActiveField(prev => prev === 'to' ? null : 'to')}
                >
                  <span className="bf-date-label">{t('end')}</span>
                  <span className={`bf-date-value ${endDate ? 'has-value' : ''}${activeField === 'to' ? ' picking' : ''}`}>
                    {activeField === 'to'
                      ? t('pickOnCalendar')
                      : endDate ? format(parse(endDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : t('select')}
                  </span>
                </div>
              </div>

              <div className="bf-cal-slide-wrap">
                <div
                  key={calSlideKey}
                  className={`bf-cal-slide ${calSlideDir === 'left' ? 'bf-cal-slide-left' : calSlideDir === 'right' ? 'bf-cal-slide-right' : ''}`}
                  onAnimationEnd={() => setCalSlideDir(null)}
                >
                  <DayPicker
                    mode="range"
                    navLayout="around"
                    selected={startDate ? { from: parse(startDate, 'yyyy-MM-dd', new Date()), to: endDate ? parse(endDate, 'yyyy-MM-dd', new Date()) : undefined } : undefined}
                    onSelect={(range, triggerDate) => {
                      if (activeField && triggerDate) {
                        const formatted = format(triggerDate, 'yyyy-MM-dd');
                        if (activeField === 'from') {
                          setStartDate(formatted);
                          if (endDate && formatted > endDate) setEndDate('');
                        } else {
                          if (startDate && formatted < startDate) {
                            setStartDate(formatted);
                            setEndDate('');
                          } else {
                            setEndDate(formatted);
                          }
                        }
                        setActiveField(null);
                      } else {
                        setStartDate(range?.from ? format(range.from, 'yyyy-MM-dd') : '');
                        setEndDate(range?.to ? format(range.to, 'yyyy-MM-dd') : '');
                      }
                    }}
                    disabled={[{ before: tomorrowDate }, ...soldOutDates]}
                    modifiers={{ soldOut: soldOutDates, unavailable: { before: tomorrowDate } }}
                    modifiersClassNames={{ soldOut: 'rdp-sold-out', unavailable: 'rdp-sold-out' }}
                    month={calendarMonth}
                    onMonthChange={navigateCalendar}
                    startMonth={todayDate}
                    endMonth={addYears(todayDate, 1)}
                    className="bf-day-picker bf-range-picker"
                  />
                </div>
              </div>
            </div>

            {/* Loading availability indicator */}
            {ltLoadingAvailability && (
              <div className="bf-loading-availability">
                <Loader variant="inline" />
                <span>{t('loadingAvailability')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ WIZARD STEP 2 — Schedule Days/Hours ═══ */}
      {wizardStep === 2 && (
        <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
          <div ref={ltScheduleRef}>
            <ScheduleSelector
              availability={availability}
              preferenceMode={isCampaignCreate}
              selectedDayDates={selectedDayDates}
              selectedHours={selectedHours}
              onDayDatesChange={setSelectedDayDates}
              onHoursChange={setSelectedHours}
              loading={ltLoadingAvailability}
              hideHeader
              summaryNode={ltHasSchedule ? (
                <div className="bf-spotlight-selection-summary">
                  <span>{t('selectionSummary', { days: totalDays, hours: totalHours })}</span>
                  <span>&#8362;{(isCampaignCreate && campaignSpaceBreakdown ? campaignEstimatedCost : totalCost).toFixed(2)}</span>
                </div>
              ) : undefined}
            />
          </div>
        </div>
      )}

      {/* ═══ WIZARD STEP 3 — Upload Media ═══ */}
      {wizardStep === 3 && (
        <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
          <div className="bf-section bf-animate-in" ref={ltUploadRef}>
            {/* <p className="bf-step-desc">{t('uploadMediaDesc')}</p> */}

            {/* Upload */}
            <div className="bf-upload-zone">
              <span className="bf-upload-zone-label">{t('creative')} <span className="bf-upload-zone-counter">{t('imagesCount', { count: existingCreatives.length + creativeFiles.length, max: 5 })}</span></span>

              {(existingCreatives.length > 0 || creativeFiles.length > 0) ? (
                <>
                  <div className="bf-upload-grid">
                    {existingCreatives.map(c => (
                      <div key={`existing-${c.id}`} className="bf-upload-grid-item">
                        {c.file_type === 'image' ? <img src={`${API_URL}${c.file_url}`} alt="" /> : <VideoThumbnail source={`${API_URL}${c.file_url}`} />}
                        <button className="bf-upload-grid-item-remove" onClick={async () => {
                          try { await deleteCreative(Number(editOrderId || 0), c.id); setExistingCreatives(prev => prev.filter(ec => ec.id !== c.id)); }
                          catch { setError(t('failedToRemoveMedia')); }
                        }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    ))}
                    {creativeFiles.map((file, idx) => {
                      const pct = uploadProgress.get(idx);
                      return (
                        <div key={`new-${idx}`} className="bf-upload-grid-item">
                          {file.type.startsWith('image/') ? <img src={URL.createObjectURL(file)} alt="" /> : <VideoThumbnail source={file} />}
                          <button className="bf-upload-grid-item-remove" onClick={() => setCreativeFiles(prev => prev.filter((_, i) => i !== idx))}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                          {pct !== undefined && pct < 100 && (
                            <div className="bf-upload-progress-overlay">
                              <div className="bf-upload-progress-bar" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {existingCreatives.length + creativeFiles.length < 5 && (
                      <label className="bf-upload-grid-add">
                        <input type="file" accept="image/*,video/*" multiple onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                          if (!e.target.files) return;
                          const remaining = 5 - existingCreatives.length - creativeFiles.length;
                          if (remaining <= 0) return;
                          const newFiles = Array.from(e.target.files);
                          e.target.value = '';
                          const { validFiles, errors } = await validateFiles(newFiles.slice(0, remaining));
                          if (errors.length > 0) setError(errors.join('\n'));
                          if (validFiles.length > 0) setCreativeFiles(prev => [...prev, ...validFiles]);
                        }} />
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </label>
                    )}
                  </div>
                  {existingCreatives.length + creativeFiles.length > 1 && (
                    <div className="bf-upload-notice">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
                      <span>{t('imageDivisionNotice')}</span>
                    </div>
                  )}
                </>
              ) : (
                <label
                  className="bf-upload-zone-droparea"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragging'); }}
                  onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragging'); }}
                  onDrop={async (e) => {
                    e.preventDefault(); e.currentTarget.classList.remove('dragging');
                    const droppedFiles = Array.from(e.dataTransfer.files);
                    if (droppedFiles.length === 0) return;
                    const { validFiles, errors } = await validateFiles(droppedFiles.slice(0, 5));
                    if (errors.length > 0) setError(errors.join('\n'));
                    if (validFiles.length > 0) setCreativeFiles(prev => [...prev, ...validFiles.slice(0, 5 - prev.length)]);
                  }}
                >
                  <input type="file" accept="image/*,video/*" multiple onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                    if (!e.target.files) return;
                    const picked = Array.from(e.target.files).slice(0, 5);
                    e.target.value = '';
                    const { validFiles, errors } = await validateFiles(picked);
                    if (errors.length > 0) setError(errors.join('\n'));
                    if (validFiles.length > 0) setCreativeFiles(validFiles);
                  }} />
                  <div className="bf-upload-zone-icon">
                    <svg viewBox="0 0 48 48" fill="none"><rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="1.5"/><circle cx="18" cy="22" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M6 32l10-8 8 6 8-10 10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span className="bf-upload-zone-title">{t('dropFilesHere')}</span>
                  <span className="bf-upload-zone-hint">{t('orClickTo')} <strong>{t('browseFiles')}</strong></span>
                  <span className="bf-upload-zone-formats">{t('supportedFormats')}</span>
                </label>
              )}
            </div>

            <button
              type="button"
              className="bf-vault-btn"
              onClick={() => setShowVaultPicker(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
                borderRadius: 10, border: '1px solid #e0e0e0', background: '#fafafa',
                color: '#555', fontSize: '0.88rem', cursor: 'pointer', marginTop: 10,
                transition: 'border-color 0.2s',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              {t('chooseFromVault', { ns: 'creatives' })}
            </button>

            {showVaultPicker && (
              <CreativeVaultPicker
                spaceId={space?.id}
                onSelect={async (vc: UserCreative) => {
                  setShowVaultPicker(false);
                  try {
                    const res = await fetch(`${API_URL}${vc.file_url}`);
                    const blob = await res.blob();
                    const ext = vc.original_filename.split('.').pop() || 'jpg';
                    const file = new File([blob], vc.original_filename, { type: blob.type || `image/${ext}` });
                    setCreativeFiles(prev => [...prev, file].slice(0, 5));
                  } catch { setError('Failed to load vault creative'); }
                }}
                onClose={() => setShowVaultPicker(false)}
              />
            )}

            <MediaGuidelines />

            <div className="bf-notes-compact">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('addNoteOptional')} rows={2} />
            </div>
          </div>
        </div>
      )}

      {/* ═══ WIZARD STEP 4 — Review Campaign ═══ */}
      {wizardStep === 4 && (
        <>
        <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
          <div className="bf-section bf-animate-in">

            {/* Schedule summary */}
            <div className="bf-review-schedule">
              <div className="bf-review-schedule-date">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>{startDate ? format(parse(startDate, 'yyyy-MM-dd', new Date()), 'MMM d') : '–'} – {endDate ? format(parse(endDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : '–'}</span>
              </div>
              <span className="bf-review-schedule-divider" />
              <div className="bf-review-schedule-pills">
                {(() => {
                  const allHours = new Set<number>();
                  selectedHours.forEach(hours => hours.forEach(h => allHours.add(parseInt(h.slice(0, 2)))));
                  return SEGMENTS.map(seg => {
                    const active = Array.from(allHours).some(h => h >= seg.startH && h < seg.endH);
                    if (!active) return null;
                    return <span key={seg.key} className="bf-review-segment-pill">{t(seg.label)}</span>;
                  });
                })()}
              </div>
              {(() => {
                // Primary space: prorate min/max impressions by booked/operating hours per day
                const primary = parseImpressionRange(space.estimated_daily_impressions);
                let minEyes = 0;
                let maxEyes = 0;
                selectedHours.forEach((hours, dateKey) => {
                  const booked = hours.size;
                  const opH = opHoursByDate.get(dateKey) || booked || 1;
                  const ratio = booked / opH;
                  minEyes += ratio * primary.min;
                  maxEyes += ratio * primary.max;
                });

                // Campaign spaces — prorate using available_slots per day (skip primary)
                if (isCampaignCreate && campaignSpaceBreakdown) {
                  for (const entry of campaignSpaceBreakdown) {
                    if (entry.spaceId === Number(id)) continue;
                    if (entry.status === 'none' || entry.status === 'error') continue;
                    const info = campaignSpaces.find(s => s.id === entry.spaceId);
                    const r = parseImpressionRange(info?.estimated_daily_impressions);
                    if (r.max === 0) continue;
                    const c = campaignPerSpaceCompat[entry.spaceId];
                    if (c && c !== 'loading' && c !== 'error' && c.available_slots.length > 0) {
                      const slotsByDate = new Map<string, number>();
                      for (const slot of c.available_slots) slotsByDate.set(slot.date, (slotsByDate.get(slot.date) || 0) + 1);
                      slotsByDate.forEach((booked, dateKey) => {
                        const opH = opHoursByDate.get(dateKey) || booked || 1;
                        const ratio = booked / opH;
                        minEyes += ratio * r.min;
                        maxEyes += ratio * r.max;
                      });
                    } else {
                      // Fallback: use aggregate hours with average ratio
                      const avgOpH = totalHours > 0 && totalDays > 0 ? totalHours / totalDays : 1;
                      const avgBooked = totalDays > 0 ? entry.hours / totalDays : 1;
                      const ratio = avgBooked / (avgOpH || 1);
                      minEyes += ratio * r.min * totalDays;
                      maxEyes += ratio * r.max * totalDays;
                    }
                  }
                }

                // Duplicate spaces — prorate using available_slots per day
                if (!isCampaignCreate && dupSelectedCount > 0) {
                  for (const sid of dupAvailableSelected) {
                    const info = campaignSpaces.find(sp => sp.id === sid);
                    const r = parseImpressionRange(info?.estimated_daily_impressions);
                    if (r.max === 0) continue;
                    const c = campaignCompat[sid] as Exclude<typeof campaignCompat[number], 'loading' | 'error'>;
                    if (c && c.available_slots && c.available_slots.length > 0) {
                      const slotsByDate = new Map<string, number>();
                      for (const slot of c.available_slots) slotsByDate.set(slot.date, (slotsByDate.get(slot.date) || 0) + 1);
                      slotsByDate.forEach((booked, dateKey) => {
                        const opH = opHoursByDate.get(dateKey) || booked || 1;
                        const ratio = booked / opH;
                        minEyes += ratio * r.min;
                        maxEyes += ratio * r.max;
                      });
                    }
                  }
                }

                minEyes = roundExposure(minEyes);
                maxEyes = roundExposure(maxEyes);

                // Audiences
                const audienceMap = new Map<number, string>();
                for (const a of space.audience_profiles || []) {
                  if (!audienceMap.has(a.id)) audienceMap.set(a.id, a.name);
                }
                if (isCampaignCreate && campaignSpaceBreakdown) {
                  for (const entry of campaignSpaceBreakdown) {
                    const info = campaignSpaces.find(s => s.id === entry.spaceId);
                    for (const a of info?.audience_profiles || []) {
                      if (!audienceMap.has(a.id)) audienceMap.set(a.id, a.name);
                    }
                  }
                }
                if (!isCampaignCreate && dupSelectedCount > 0) {
                  for (const sid of dupAvailableSelected) {
                    const info = campaignSpaces.find(sp => sp.id === sid);
                    for (const a of info?.audience_profiles || []) {
                      if (!audienceMap.has(a.id)) audienceMap.set(a.id, a.name);
                    }
                  }
                }
                const topAudiences = Array.from(audienceMap.values()).slice(0, 3);

                if (maxEyes === 0 && topAudiences.length === 0) return null;
                const isRange = minEyes !== maxEyes && minEyes > 0;
                return (
                  <div className="bf-review-exposure">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>
                      {maxEyes > 0 && (isRange
                        ? t('estimatedExposureRange', { min: minEyes.toLocaleString(), max: maxEyes.toLocaleString() })
                        : t('estimatedExposure', { eyes: maxEyes.toLocaleString() })
                      )}
                      {maxEyes > 0 && topAudiences.length > 0 }
                      {topAudiences.length > 0 }
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* ── Unified space cards grid ── */}
            {(() => {
              // Build a unified list of all spaces in the campaign/order
              type ReviewSpaceCard = {
                id: number;
                name: string;
                city: string;
                image: string | null;
                hours: number;
                cost: number;
                status: string;
                isPrimary: boolean;
                slots?: { date: string; times: string[] }[];
                onRemove?: () => void;
                minEyes: number;
                maxEyes: number;
                conflicts?: { date: string; start_time: string; end_time: string; reason: string }[];
                totalSourceSlots?: number;
              };

              const cards: ReviewSpaceCard[] = [];

              // Primary space (always first) — use compat result if available in campaign mode
              const primaryIdNum = Number(id);
              const primaryCompat = isCampaignCreate ? campaignPerSpaceCompat[primaryIdNum] : undefined;
              const primaryHasCompat = primaryCompat && primaryCompat !== 'loading' && primaryCompat !== 'error';
              const primaryHours = primaryHasCompat ? primaryCompat.available_count : totalHours;
              const primaryCost = primaryHasCompat ? primaryCompat.estimated_cost : totalCost;
              const primaryStatus = primaryHasCompat ? primaryCompat.compatibility : 'full';

              // Per-card eyes: use compat slots if available, otherwise selectedHours
              const primaryImpr = parseImpressionRange(space.estimated_daily_impressions);
              let primaryMinEyes = 0;
              let primaryMaxEyes = 0;
              if (primaryHasCompat && primaryCompat.available_slots.length > 0) {
                const slotCountByDate = new Map<string, number>();
                for (const slot of primaryCompat.available_slots) slotCountByDate.set(slot.date, (slotCountByDate.get(slot.date) || 0) + 1);
                slotCountByDate.forEach((booked, dateKey) => {
                  const opH = opHoursByDate.get(dateKey) || booked || 1;
                  const ratio = booked / opH;
                  primaryMinEyes += ratio * primaryImpr.min;
                  primaryMaxEyes += ratio * primaryImpr.max;
                });
              } else {
                selectedHours.forEach((hours, dateKey) => {
                  const booked = hours.size;
                  const opH = opHoursByDate.get(dateKey) || booked || 1;
                  const ratio = booked / opH;
                  primaryMinEyes += ratio * primaryImpr.min;
                  primaryMaxEyes += ratio * primaryImpr.max;
                });
              }
              primaryMinEyes = roundExposure(primaryMinEyes);
              primaryMaxEyes = roundExposure(primaryMaxEyes);

              // Build primary slots for expansion (only when partial)
              const primarySlots: { date: string; times: string[] }[] = [];
              if (primaryHasCompat && primaryCompat.available_slots.length > 0) {
                const slotsByDate = new Map<string, string[]>();
                for (const slot of primaryCompat.available_slots) {
                  if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, []);
                  slotsByDate.get(slot.date)!.push(`${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`);
                }
                for (const [date, times] of Array.from(slotsByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
                  primarySlots.push({ date, times });
                }
              }

              cards.push({
                id: primaryIdNum,
                name: space.name,
                city: space.city ? [space.city, space.full_address].filter(Boolean).join(', ') : '',
                image: primaryImage,
                hours: primaryHours,
                cost: primaryCost,
                status: primaryStatus,
                isPrimary: true,
                minEyes: primaryMinEyes,
                maxEyes: primaryMaxEyes,
                slots: primarySlots.length > 0 ? primarySlots : undefined,
                conflicts: primaryHasCompat && primaryCompat.conflicts.length > 0 ? primaryCompat.conflicts : undefined,
                totalSourceSlots: primaryHasCompat ? primaryCompat.total_source_slots : undefined,
              });

              // Campaign mode spaces (skip primary to avoid duplicate; keep unavailable for visibility)
              if (isCampaignCreate && campaignSpaceBreakdown) {
                for (const entry of campaignSpaceBreakdown) {
                  if (entry.spaceId === Number(id)) continue;
                  const compat = campaignPerSpaceCompat[entry.spaceId];
                  const spaceInfo = campaignSpaces.find(s => s.id === entry.spaceId);
                  const slots: { date: string; times: string[] }[] = [];
                  let cardMinEyes = 0;
                  let cardMaxEyes = 0;
                  let cardConflicts: { date: string; start_time: string; end_time: string; reason: string }[] | undefined;
                  let cardTotalSourceSlots: number | undefined;
                  if (compat && compat !== 'loading' && compat !== 'error') {
                    if (compat.available_slots.length > 0) {
                      const slotsByDate = new Map<string, string[]>();
                      for (const slot of compat.available_slots) {
                        if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, []);
                        slotsByDate.get(slot.date)!.push(`${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`);
                      }
                      for (const [date, times] of Array.from(slotsByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
                        slots.push({ date, times });
                      }
                    }
                    // Per-card eyes proration
                    const r = parseImpressionRange(spaceInfo?.estimated_daily_impressions);
                    if (r.max > 0 && compat.available_slots.length > 0) {
                      const slotCountByDate = new Map<string, number>();
                      for (const slot of compat.available_slots) slotCountByDate.set(slot.date, (slotCountByDate.get(slot.date) || 0) + 1);
                      slotCountByDate.forEach((booked, dateKey) => {
                        const opH = opHoursByDate.get(dateKey) || booked || 1;
                        const ratio = booked / opH;
                        cardMinEyes += ratio * r.min;
                        cardMaxEyes += ratio * r.max;
                      });
                      cardMinEyes = roundExposure(cardMinEyes);
                      cardMaxEyes = roundExposure(cardMaxEyes);
                    }
                    // Conflicts
                    if (compat.conflicts && compat.conflicts.length > 0) {
                      cardConflicts = compat.conflicts;
                    }
                    cardTotalSourceSlots = compat.total_source_slots;
                  }
                  cards.push({
                    id: entry.spaceId,
                    name: entry.name,
                    city: spaceInfo?.city || '',
                    image: spaceInfo?.first_image || null,
                    hours: entry.hours,
                    cost: entry.cost,
                    status: entry.status,
                    isPrimary: false,
                    slots,
                    onRemove: () => setCampaignRemovedSpaces(prev => { const next = new Set(prev); next.add(entry.spaceId); return next; }),
                    minEyes: cardMinEyes,
                    maxEyes: cardMaxEyes,
                    conflicts: cardConflicts,
                    totalSourceSlots: cardTotalSourceSlots,
                  });
                }
              }

              // Duplicate mode spaces (non-campaign)
              if (!isCampaignCreate && dupSelectedCount > 0) {
                for (const sid of dupAvailableSelected) {
                  const c = campaignCompat[sid] as Exclude<typeof campaignCompat[number], 'loading' | 'error'>;
                  const spaceInfo = campaignSpaces.find(sp => sp.id === sid);
                  const slots: { date: string; times: string[] }[] = [];
                  let dupMinEyes = 0;
                  let dupMaxEyes = 0;
                  if (c.available_slots && c.available_slots.length > 0) {
                    const slotsByDate = new Map<string, string[]>();
                    for (const slot of c.available_slots) {
                      if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, []);
                      slotsByDate.get(slot.date)!.push(`${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`);
                    }
                    for (const [date, times] of Array.from(slotsByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
                      slots.push({ date, times });
                    }
                    // Per-card eyes proration
                    const r = parseImpressionRange(spaceInfo?.estimated_daily_impressions);
                    if (r.max > 0) {
                      const slotCountByDate = new Map<string, number>();
                      for (const slot of c.available_slots) slotCountByDate.set(slot.date, (slotCountByDate.get(slot.date) || 0) + 1);
                      slotCountByDate.forEach((booked, dateKey) => {
                        const opH = opHoursByDate.get(dateKey) || booked || 1;
                        const ratio = booked / opH;
                        dupMinEyes += ratio * r.min;
                        dupMaxEyes += ratio * r.max;
                      });
                      dupMinEyes = roundExposure(dupMinEyes);
                      dupMaxEyes = roundExposure(dupMaxEyes);
                    }
                  }
                  cards.push({
                    id: sid,
                    name: spaceInfo?.name || c.target_space_name,
                    city: spaceInfo?.city || '',
                    image: spaceInfo?.first_image || null,
                    hours: c.available_count,
                    cost: c.estimated_cost,
                    status: c.compatibility,
                    isPrimary: false,
                    slots,
                    onRemove: () => setCampaignSelected(prev => { const next = new Set(prev); next.delete(sid); return next; }),
                    minEyes: dupMinEyes,
                    maxEyes: dupMaxEyes,
                    conflicts: c.conflicts && c.conflicts.length > 0 ? c.conflicts : undefined,
                    totalSourceSlots: c.total_source_slots,
                  });
                }
              }

              const availableCards = cards.filter(c => c.status !== 'none' && c.status !== 'error');
              const campaignTotalCost = availableCards.reduce((s, c) => s + c.cost, 0);
              const campaignTotalHours = availableCards.reduce((s, c) => s + c.hours, 0);
              const hasMultiple = cards.length > 1;

              return (
                <>
                  {campaignPerSpaceCompatLoading && isCampaignCreate ? (
                    <div className="bf-campaign-total-loading">
                      <Loader variant="inline" />
                      <span>{t('checkingSpaces')}</span>
                    </div>
                  ) : (
                    <div className="bf-rv-cards-grid">
                      {cards.map(card => {
                        const isExp = expandedBreakdownSpace === card.id;
                        return (
                          <div key={card.id} className={`bf-rv-card${isExp ? ' bf-rv-card-expanded' : ''}${card.status === 'none' || card.status === 'error' ? ' bf-rv-card-unavailable' : ''}`}>
                            <div className="bf-rv-card-top">
                              <div className="bf-rv-card-img-wrap">
                                {card.image
                                  ? <img className="bf-rv-card-img" src={`${API_URL}${card.image}`} alt={card.name} />
                                  : <div className="bf-rv-card-img bf-rv-card-img-ph" />
                                }
                              </div>
                              <div className="bf-rv-card-info">
                                <span className="bf-rv-card-name">{card.name}</span>
                                {(card.status === 'partial' && card.hours === 0) && <span className="bf-rv-card-badge bf-status-none">{t('spaceAvailNone')}</span>}
                                {(card.status === 'none' || card.status === 'error') && <span className="bf-rv-card-badge bf-status-none">{card.status === 'error' ? t('error') : t('spaceAvailNone')}</span>}
                              </div>
                              {!card.isPrimary && card.onRemove && (
                                <button type="button" className="bf-campaign-space-remove" onClick={card.onRemove} title={t('removeSpace')}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              )}
                            </div>
                            <div className="bf-rv-card-bottom">
                              {/* Hours */}
                              <div className="bf-rv-card-stat">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                {card.status === 'partial' && card.hours > 0 ? (
                                  <button type="button" className={`bf-rv-hours-btn bf-rv-hours-orange${isExp ? ' expanded' : ''}`} onClick={() => setExpandedBreakdownSpace(isExp ? null : card.id)}>
                                    <span>{card.hours}h</span>
                                    <svg className="bf-rv-hours-chev" viewBox="0 0 16 16" fill="none" width="10" height="10"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </button>
                                ) : card.hours > 0 ? (
                                  <span>{card.hours}h</span>
                                ) : (
                                  <span className="bf-rv-no-avail">{t('noAvailable')}</span>
                                )}
                              </div>

                              {/* Eyes — only if maxEyes > 0 */}
                              {card.maxEyes > 0 && (
                                <div className="bf-rv-card-stat bf-rv-card-eyes">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                  <span>~{card.minEyes !== card.maxEyes
                                    ? `${card.minEyes.toLocaleString()}–${card.maxEyes.toLocaleString()}`
                                    : card.maxEyes.toLocaleString()}</span>
                                </div>
                              )}

                              {/* Price */}
                              {card.hours > 0 ? (
                                <span className="bf-rv-card-cost">&#8362;{card.cost.toFixed(2)}</span>
                              ) : (
                                <span className="bf-rv-card-cost bf-rv-card-cost--na">–</span>
                              )}
                            </div>

                            {/* Expanded: conflict summary */}
                            {isExp && (() => {
                              const requestedHours = card.totalSourceSlots || totalHours;
                              const pct = requestedHours > 0 ? Math.round((card.hours / requestedHours) * 100) : 0;

                              return (
                                <div className="bf-rv-conflict-summary">
                                  <div className="bf-rv-conflict-header">
                                    <div className="bf-rv-conflict-bar">
                                      <div className="bf-rv-conflict-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                                    </div>
                                    <div className="bf-rv-conflict-header-nums">
                                      <span>{t('conflictAvailableShort', { hours: card.hours, pct })}</span>
                                    </div>
                                  </div>
                                  <div className="bf-rv-conflict-reason-row">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                    <span>{t('conflictUnifiedReason')}</span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                      {!isEditMode && (
                        <button type="button" className="bf-rv-dup-card" onClick={() => {
                          if (isCampaignCreate) {
                            loadCampaignExtraSpaces();
                            setShowDuplicateSheet(true);
                          } else {
                            const days: SelectedDay[] = [];
                            selectedHours.forEach((hours, dateKey) => {
                              if (hours.size > 0) {
                                days.push({ date: dateKey, time_ranges: getTimeRangesForDay(dateKey) });
                              }
                            });
                            pendingOrderDataRef.current = {
                              space_id: Number(id),
                              booking_type: 'long_term',
                              start_date: startDate,
                              end_date: endDate,
                              selected_days: days,
                              notes: notes || undefined,
                            };
                            pendingScheduleSlotsRef.current = selectedDaysToScheduleSlots(days);
                            loadCampaignSpaces();
                            setShowDuplicateSheet(true);
                          }
                        }} disabled={loading}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          <span>{t('duplicateToAnotherSpace')}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Total row */}
                  {hasMultiple && (
                    <div className="bf-rv-total">
                      <span>{t('campaignTotal')}</span>
                      <strong>&#8362;{campaignTotalCost.toFixed(2)}</strong>
                    </div>
                  )}
                </>
              );
            })()}

            {!isEditMode && <p className="bf-payment-note">{t('paymentNote')}</p>}
          </div>
        </div>
        </>
      )}

      {/* ═══ WIZARD STEP 5 — Confirmation / Success ═══ */}
      {wizardStep === 5 && success && (() => {
        const hasCampaign = campaignCreated.length > 0;
        const primaryImage = space.images?.[0]?.image_url || null;
        const allCards = hasCampaign
          ? campaignCreated.map(c => ({ image: c.image || null, name: c.spaceTitle, city: c.city || '', hours: c.hours, cost: c.cost }))
          : [{ image: primaryImage, name: space.name, city: space.city ? [space.city, space.full_address].filter(Boolean).join(', ') : '', hours: totalHours, cost: totalCost }];
        const allCost = allCards.reduce((s, c) => s + c.cost, 0);
        const allHours = allCards.reduce((s, c) => s + c.hours, 0);

        return (
          <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
            <div className="bf-section bf-animate-in bf-step5-wrap">
              {/* Success hero */}
              <div className="bf-step5-hero">
                <div className="bf-step5-hero-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <h2 className="bf-step5-hero-title">{isEditMode ? t('orderUpdatedSuccess') : hasCampaign ? t('campaignCreated') : t('bookingConfirmed')}</h2>
                <p className="bf-step5-hero-sub">{hasCampaign
                  ? t('campaignSummary', { spaces: allCards.length, hours: allHours, cost: allCost.toFixed(2) })
                  : <>{t('bookingForPrefix')} <strong>{space.name}</strong> {t('bookingForSuffixSubmitted')}</>
                }</p>
              </div>

              {/* Summary strip */}
              <div className="bf-step5-summary">
                <div className="bf-step5-summary-item">
                  <span className="bf-step5-summary-label">{t('spacesLabel')}</span>
                  <span className="bf-step5-summary-val">{allCards.length}</span>
                </div>
                <div className="bf-step5-summary-divider" />
                <div className="bf-step5-summary-item">
                  <span className="bf-step5-summary-label">{t('totalHoursLabel', { defaultValue: 'Hours' })}</span>
                  <span className="bf-step5-summary-val">{allHours}</span>
                </div>
                <div className="bf-step5-summary-divider" />
                <div className="bf-step5-summary-item">
                  <span className="bf-step5-summary-label">{t('total')}</span>
                  <span className="bf-step5-summary-val">&#8362;{allCost.toFixed(2)}</span>
                </div>
              </div>

              {/* Space cards */}
              <div className="bf-step5-cards">
                {allCards.map((card, i) => (
                  <div key={i} className="bf-step5-card">
                    <div className="bf-step5-card-img">
                      {card.image
                        ? <img src={`${API_URL}${card.image}`} alt={card.name} />
                        : <div className="bf-step5-card-img-ph" />
                      }
                    </div>
                    <div className="bf-step5-card-info">
                      <span className="bf-step5-card-name">{card.name}</span>
                      {card.city && <span className="bf-step5-card-city">{card.city}</span>}
                    </div>
                    <div className="bf-step5-card-meta">
                      <span className="bf-step5-card-hours">{card.hours}h</span>
                      <span className="bf-step5-card-cost">&#8362;{card.cost.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Conflict Detail Modal ═══ */}
      {conflictDetailCard && (() => {
        const cd = conflictDetailCard;
        const pct = cd.totalSourceSlots > 0 ? Math.round((cd.hours / cd.totalSourceSlots) * 100) : 0;

        return (
          <>
            <div className="bf-conflict-modal-overlay" onClick={() => setConflictDetailCard(null)} />
            <div className="bf-conflict-modal">
              <div className="bf-conflict-modal-header">
                <h3>{cd.name}</h3>
                <button type="button" className="bf-conflict-modal-close" onClick={() => setConflictDetailCard(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              {/* Summary bar */}
              <div className="bf-conflict-modal-summary">
                <div className="bf-rv-conflict-bar">
                  <div className="bf-rv-conflict-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <span className="bf-conflict-modal-summary-text">{t('conflictAvailableShort', { hours: cd.hours, pct })}</span>
              </div>

              {/* Single unified explanation */}
              <p className="bf-conflict-modal-unified-reason">{t('conflictUnifiedReason')}</p>
            </div>
          </>
        );
      })()}

      {/* ═══ Duplicate to Another Space — Bottom Sheet Modal ═══ */}
      {showDuplicateSheet && (() => {
        const filteredCampaignSpaces = campaignSpaces.filter(s => {
          const q = campaignSearch.toLowerCase().trim();
          if (q && !s.name.toLowerCase().includes(q) && !(s.city || '').toLowerCase().includes(q)) return false;
          if (campaignCategory !== 'all' && s.space_type?.name !== campaignCategory) return false;
          const range = PRICE_RANGES[campaignPriceIdx];
          if (s.price_per_day < range.min || s.price_per_day > range.max) return false;
          return true;
        });

        const sortedSpaces = [...filteredCampaignSpaces].sort((a, b) => {
          const order = (sid: number) => {
            const c = campaignCompat[sid];
            if (!c || c === 'loading' || c === 'error') return 3;
            if (c.compatibility === 'full') return 0;
            if (c.compatibility === 'partial') return 1;
            return 2;
          };
          return order(a.id) - order(b.id);
        });

        const stillLoading = Object.values(campaignCompat).some(c => c === 'loading');

        const availableSelected = Array.from(campaignSelected).filter(sid => {
          const c = campaignCompat[sid];
          return c && c !== 'loading' && c !== 'error' && c.compatibility !== 'none';
        });
        const selectedCount = availableSelected.length;
        const selectedCost = availableSelected.reduce((sum, sid) => {
          const c = campaignCompat[sid];
          if (c && c !== 'loading' && c !== 'error') return sum + c.estimated_cost;
          return sum;
        }, 0);

        const dismissSheet = () => {
          if (isCampaignCreate && savedCampaignSpacesRef.current.length > 0) {
            setCampaignSpaces(savedCampaignSpacesRef.current);
          }
          setShowDuplicateSheet(false);
        };

        // Show fullpage loader while spaces are still loading
        const spacesStillLoading = campaignSpaces.length === 0 && Object.keys(campaignCompat).length === 0;

        if (spacesStillLoading) {
          if (isMobile) {
            return (
              <FluidDrawer open={true} onOpenChange={() => {}} title={t('addMoreSpacesDesc')} dismissible={false}>
                <div className="bf-dup-sheet-loader" style={{ padding: '48px 0', textAlign: 'center' }}>
                  <Loader variant="inline" />
                </div>
              </FluidDrawer>
            );
          }
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
            <div className="bf-dup-sheet-content">
              <div className="aasm-sticky-header">
                <div className="bf-campaign-header">
                  <h2>{t('addMoreSpacesDesc')}</h2>
                </div>

                <div className="bf-campaign-filters">
                  <div className="filter-bar-search">
                    <input
                      type="text"
                      className="filter-bar-search-input"
                      placeholder={t('searchSpaces', { ns: 'common' })}
                      value={campaignSearch}
                      onChange={e => setCampaignSearch(e.target.value)}
                    />
                    {campaignSearch && (
                      <button type="button" className="filter-bar-search-clear" onClick={() => setCampaignSearch('')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    )}
                    <span className="filter-bar-search-btn">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    </span>
                  </div>
                  <div className="bf-campaign-filter-row">
                    <FilterDropdown value={campaignCategory} options={campaignCategoryOptions} onChange={setCampaignCategory} />
                    <FilterDropdown value={campaignPriceIdx} options={campaignPriceOptions} onChange={setCampaignPriceIdx} />
                  </div>
                </div>
              </div>{/* end aasm-sticky-header */}

              <div className="bf-campaign-scroll">
                {stillLoading ? (
                  <div className="bf-dup-sheet-loader">
                    <Loader variant="inline" />
                    <span>{t('checkingSpaces')}</span>
                  </div>
                ) : (
                  <div className="bf-campaign-grid">
                    {sortedSpaces.map(s => {
                      const compat = campaignCompat[s.id];
                      const isError = compat === 'error';
                      const result = (compat && compat !== 'loading' && compat !== 'error') ? compat : null;
                      const isNone = result?.compatibility === 'none';
                      const isFull = result?.compatibility === 'full';
                      const isPartial = result?.compatibility === 'partial';
                      const isSelected = campaignSelected.has(s.id);
                      const disabled = isError || isNone;

                      return (
                        <button
                          key={s.id}
                          className={`bf-campaign-card${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                          onClick={() => !disabled && toggleCampaignSpace(s.id)}
                          disabled={disabled}
                        >
                          {isSelected && (
                            <span className="bf-campaign-card-overlay">
                              <svg viewBox="0 0 24 24" fill="none" width="32" height="32" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                            </span>
                          )}
                          <div className="bf-campaign-card-img-wrap">
                            {s.first_image && (
                              <img className="bf-campaign-card-img" src={`${API_URL}${s.first_image}`} alt={s.name} />
                            )}
                          </div>
                          <div className="bf-campaign-card-body">
                            <span className="bf-campaign-card-name">{s.name}</span>
                            {s.city && <span className="bf-campaign-card-meta">{s.city}</span>}
                            {(isError || isNone) && <span className="bf-campaign-card-badge bf-badge-none">{isError ? t('error') : t('notAvailable')}</span>}
                            {result && !isNone && (() => {
                              const pct = result.total_source_slots > 0 ? Math.round((result.available_count / result.total_source_slots) * 100) : 0;
                              const r = parseImpressionRange(s.estimated_daily_impressions);
                              let cardMinEyes = 0, cardMaxEyes = 0;
                              if (r.max > 0 && result.available_slots.length > 0) {
                                const slotCountByDate = new Map<string, number>();
                                for (const slot of result.available_slots) slotCountByDate.set(slot.date, (slotCountByDate.get(slot.date) || 0) + 1);
                                slotCountByDate.forEach((booked, dateKey) => {
                                  const opH = opHoursByDate.get(dateKey) || booked || 1;
                                  cardMinEyes += (booked / opH) * r.min;
                                  cardMaxEyes += (booked / opH) * r.max;
                                });
                                cardMinEyes = roundExposure(cardMinEyes);
                                cardMaxEyes = roundExposure(cardMaxEyes);
                              }
                              return (
                                <div className="bf-campaign-card-stats">
                                  {/* Hours */}
                                  <div className="bf-campaign-card-stat">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    <span className={isPartial ? 'bf-campaign-card-stat-orange' : ''}>{result.available_count}h{isPartial ? ` (${pct}%)` : ''}</span>
                                  </div>
                                  {/* Eyes */}
                                  {cardMaxEyes > 0 && (
                                    <div className="bf-campaign-card-stat bf-campaign-card-stat-eyes">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      <span>~{cardMinEyes !== cardMaxEyes ? `${cardMinEyes.toLocaleString()}–${cardMaxEyes.toLocaleString()}` : cardMaxEyes.toLocaleString()}</span>
                                    </div>
                                  )}
                                  {/* Price */}
                                  <span className="bf-campaign-card-stat-price">&#8362;{result.estimated_cost.toFixed(2)}</span>
                                </div>
                              );
                            })()}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="bf-dup-sheet-bottom">
              <button className="bf-btn bf-btn-ghost" onClick={() => { setCampaignSelected(new Set()); dismissSheet(); }} disabled={loading || campaignCreating}>
                {t('skip')}
              </button>
              {selectedCount > 0 ? (
                <button
                  className="bf-btn bf-btn-primary"
                  onClick={() => {
                    if (isCampaignCreate) {
                      // Merge selected spaces into the campaign
                      // Split: restored = were in original campaign but removed; truly new = never in campaign
                      const restoredIds = availableSelected.filter(sid => campaignSpaceIds.includes(sid) && campaignRemovedSpaces.has(sid));
                      const newIds = availableSelected.filter(sid => !campaignSpaceIds.includes(sid) && !campaignExtraSpaceIds.includes(sid));

                      if (restoredIds.length > 0 || newIds.length > 0) {
                        // Un-remove restored originals (they're already in campaignSpaceIds)
                        if (restoredIds.length > 0) {
                          setCampaignRemovedSpaces(prev => {
                            const next = new Set(prev);
                            for (const sid of restoredIds) next.delete(sid);
                            return next;
                          });
                        }
                        // Add truly new spaces to extras
                        if (newIds.length > 0) {
                          setCampaignExtraSpaceIds(prev => [...prev, ...newIds]);
                        }
                        // Merge compat results into campaignPerSpaceCompat
                        const allAdded = [...restoredIds, ...newIds];
                        const extraCompat: Record<number, CompatibilityResult | 'error'> = {};
                        for (const sid of allAdded) {
                          const c = campaignCompat[sid];
                          if (c && c !== 'loading') extraCompat[sid] = c;
                        }
                        setCampaignPerSpaceCompat(prev => ({ ...prev, ...extraCompat }));
                        // Restore saved campaign spaces + merge new space infos
                        const newSpaceInfos = campaignSpaces.filter(s => allAdded.includes(s.id));
                        const saved = savedCampaignSpacesRef.current;
                        const merged = [...saved];
                        const mergedIds = new Set(saved.map(s => s.id));
                        for (const s of newSpaceInfos) {
                          if (!mergedIds.has(s.id)) merged.push(s);
                        }
                        setCampaignSpaces(merged);
                      } else {
                        // No new spaces added, restore saved
                        setCampaignSpaces(savedCampaignSpacesRef.current);
                      }
                    }
                    setShowDuplicateSheet(false);
                  }}
                  disabled={stillLoading}
                >
                  {t('addSpacesButton', { count: selectedCount, cost: selectedCost.toFixed(2) })}
                </button>
              ) : (
                <button className="bf-btn bf-btn-primary" onClick={dismissSheet}>
                  {t('continue', { ns: 'common' })}
                </button>
              )}
            </div>
          </>
        );

        // Mobile: FluidDrawer
        if (isMobile) {
          return (
            <FluidDrawer
              open={showDuplicateSheet}
              onOpenChange={(o) => { if (!o) dismissSheet(); }}
              title={t('addMoreSpacesDesc')}
              dismissible={!campaignCreating}
            >
              {sheetInner}
            </FluidDrawer>
          );
        }

        // Desktop: existing sheet
        return (
          <>
            <div className="bf-dup-overlay" onClick={dismissSheet} />
            <div className={`bf-dup-sheet aasm-sheet open`}>
              <div className="bf-dup-sheet-handle"><div className="bf-dup-sheet-handle-bar" /></div>
              {sheetInner}
            </div>
          </>
        );
      })()}

      {/* ═══ Wizard Bottom Bar — always visible ═══ */}
      <div className="bf-wizard-bottom-bar">
        <BottomProgressBar currentStep={wizardStep} totalSteps={ltSteps.length} />
        <div className="bf-wizard-bottom-inner">
          {/* Back + Cost row */}
          {wizardStep < 5 && (wizardStep > 1 || (wizardStep >= 2 && ltHasSchedule)) && (
            <div className="bf-wizard-bottom-row">
              {wizardStep > 1 ? (
                <button className="bf-wizard-back-btn" onClick={() => goToWizardStep(wizardStep - 1)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
                  {t('back')}
                </button>
              ) : <div />}
              {wizardStep >= 2 && ltHasSchedule && (
                <div className="bf-bottom-cost">
                  <span className="bf-bottom-cost-amount">&#8362;{(isCampaignCreate && campaignSpaceBreakdown ? campaignEstimatedCost : dupSelectedCount > 0 ? dupCombinedTotal : totalCost).toFixed(2)}</span>
                  <span className="bf-bottom-cost-detail">{isCampaignCreate && campaignSpaceBreakdown ? t('spacesCountOnly', { count: campaignSpaceBreakdown.filter(e => e.status !== 'none' && e.status !== 'error').length + 1 }) : dupSelectedCount > 0 ? t('spacesCountOnly', { count: dupSelectedCount + 1 }) : t('datesCount', { count: totalDays })}</span>
                </div>
              )}
            </div>
          )}

          {/* Full-width primary button per step */}
          {wizardStep === 1 && (
            <button className="bf-btn bf-btn-confirm" disabled={!canAdvanceStep1 || ltLoadingAvailability} onClick={async () => {
              // Always fetch fresh availability before showing the schedule step
              await fetchLtAvailability(startDate, endDate);
              goToWizardStep(2);
            }}>
              {ltLoadingAvailability
                ? <><Loader variant="button" className="loader-light" /> {t('loadingAvailability')}</>
                : t('continueBtn')
              }
            </button>
          )}
          {wizardStep === 2 && (
            <button className="bf-btn bf-btn-confirm" disabled={!canAdvanceStep2} onClick={() => goToWizardStep(3)}>
              {t('continueBtn')}
            </button>
          )}
          {wizardStep === 3 && (
            <button className="bf-btn bf-btn-confirm" disabled={!canAdvanceStep3} onClick={() => {
              if (isCampaignCreate && campaignSpaceIds.length > 0) {
                const allIds = [Number(id), ...campaignSpaceIds];
                const initial: Record<number, 'loading'> = {};
                for (const sid of allIds) initial[sid] = 'loading';
                setCampaignPerSpaceCompat(initial);
                setCampaignRemovedSpaces(new Set());

                const days: SelectedDay[] = [];
                selectedHours.forEach((hours, dateKey) => {
                  if (hours.size > 0) days.push({ date: dateKey, time_ranges: getTimeRangesForDay(dateKey) });
                });
                const slots = selectedDaysToScheduleSlots(days);
                Promise.allSettled(
                  allIds.map(sid => checkScheduleCompatibility(slots, sid))
                ).then(results => {
                  const compat: Record<number, CompatibilityResult | 'error'> = {};
                  for (let i = 0; i < allIds.length; i++) {
                    compat[allIds[i]] = results[i].status === 'fulfilled' ? results[i].value : 'error';
                  }
                  setCampaignPerSpaceCompat(compat);
                });
              }
              goToWizardStep(4);
            }}>
              {t('continueBtn')}
            </button>
          )}
          {wizardStep === 4 && (
            <button
              className="bf-btn bf-btn-confirm"
              disabled={loading || campaignCreating}
              onClick={() => {
                if (isCampaignCreate) {
                  handleSubmit();
                } else if (dupSelectedCount > 0) {
                  handleCreateCampaign();
                } else {
                  skipCampaign();
                }
              }}
            >
              {loading || campaignCreating
                ? <><Loader variant="button" className="loader-light" /> {isEditMode ? t('updating') : t('booking')}</>
                : <>{isEditMode ? t('updateOrder') : t('sendBookingRequest')}</>
              }
            </button>
          )}
          {wizardStep === 5 && (
            <div className="bf-step5-bottom-btns">
              <button className="bf-step5-bottom-btn bf-step5-bottom-btn-outline" onClick={() => navigate('/create-campaign')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                {t('finishAndStartNewCampaign')}
              </button>
              <button className="bf-step5-bottom-btn bf-step5-bottom-btn-fill" onClick={() => navigate('/orders')}>
                {t('viewMyOrders')}
              </button>
            </div>
          )}
        </div>
      </div>

      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert onClose={() => setError('')} severity="error" icon={<ErrorOutline />} variant="filled" sx={{ borderRadius: 3, fontWeight: 600, fontSize: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>{error}</Alert>
      </Snackbar>
    </div>
  );
}
