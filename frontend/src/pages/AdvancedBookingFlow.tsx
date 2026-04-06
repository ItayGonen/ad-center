import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAvailability } from '../services/spaces';
import type { SpaceDetail, DayAvailability } from '../services/spaces';
import { useCampaignContext } from '../context/CampaignContext';
import { createOrder, uploadCreative, createCampaign, finalizeCampaign } from '../services/orders';
import type { SelectedDay } from '../services/orders';
import { Snackbar, Alert } from '@mui/material';
import { ErrorOutline } from '@mui/icons-material';
import Loader from '../components/Loader';
import DateRangePicker from '../components/DateRangePicker';
import ScheduleSelector, { generateHourSlots } from '../components/ScheduleSelector';
import CreativeUploader from '../components/CreativeUploader';
import { format, parse, addDays, startOfDay, parseISO } from 'date-fns';
import { API_URL } from '../services/api';

/* ───────────────────────── helpers (unchanged) ───────────────────────── */

function BottomProgressBar({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div className="bf-progress-bar">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className={`bf-progress-bar-seg${i < currentStep ? ' filled' : ''}`} />
      ))}
    </div>
  );
}



interface LocationConfig {
  spaceId: number;
  space: SpaceDetail | null;
  startDate: string;
  endDate: string;
  availability: DayAvailability[];
  selectedDayDates: Set<string>;
  selectedHours: Map<string, Set<string>>;
  creativeFiles: File[];
  notes: string;
  isLoadingAvailability: boolean;
  isLoadingSpace: boolean;
}

function getTimeRangesForDay(selectedHours: Map<string, Set<string>>, dateKey: string): { start_time: string; end_time: string }[] {
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

function isLocationComplete(loc: LocationConfig): boolean {
  if (!loc.startDate || !loc.endDate) return false;
  let totalHours = 0;
  loc.selectedHours.forEach(s => totalHours += s.size);
  if (totalHours === 0) return false;
  if (loc.creativeFiles.length === 0) return false;
  return true;
}

function getLocationStatus(loc: LocationConfig): 'complete' | 'incomplete' | 'not_started' {
  if (isLocationComplete(loc)) return 'complete';
  if (loc.startDate || loc.endDate || loc.creativeFiles.length > 0) return 'incomplete';
  let h = 0;
  loc.selectedHours.forEach(s => h += s.size);
  if (h > 0) return 'incomplete';
  return 'not_started';
}

/** Parse "HH:MM" to decimal hours (e.g. "09:30" → 9.5). Matches backend precision. */
function parseTimeDecimal(t: string): number {
  const h = parseInt(t.slice(0, 2));
  const m = parseInt(t.slice(3, 5)) || 0;
  return h + m / 60;
}

function parseImpressionRange(val?: string): { min: number; max: number } {
  if (!val) return { min: 0, max: 0 };
  const nums = val.match(/\d+/g);
  if (!nums || nums.length === 0) return { min: 0, max: 0 };
  const a = parseInt(nums[0]);
  const b = nums.length > 1 ? parseInt(nums[1]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function roundExposure(n: number): number {
  if (n < 1000) return Math.round(n / 100) * 100;
  return Math.round(n / 1000) * 1000;
}

function getLocationHours(loc: LocationConfig): number {
  let total = 0;
  loc.selectedHours.forEach(s => total += s.size);
  return total;
}

function getLocationDays(loc: LocationConfig): number {
  let count = 0;
  for (const date of loc.selectedDayDates) {
    const hours = loc.selectedHours.get(date);
    if (hours && hours.size > 0) count++;
  }
  return count;
}

function getLocationCost(loc: LocationConfig): number {
  if (!loc.space) return 0;
  const pricePerDay = loc.space.price_per_day || 0;
  // Prorated daily rate: (price_per_day / bookable_slots) * selected_slots per date.
  // Denominator = number of whole-hour slots (floor(end) - ceil(start)), NOT the exact
  // operating-hour span, so that booking "all day" always equals price_per_day.
  let cost = 0;
  const opSlotsByDate = new Map<string, number>();
  for (const day of loc.availability) {
    if (day.operating_hours) {
      const startH = Math.ceil(parseTimeDecimal(day.operating_hours.start_time));
      const endH = Math.floor(parseTimeDecimal(day.operating_hours.end_time));
      opSlotsByDate.set(day.date, Math.max(endH - startH, 1));
    }
  }
  loc.selectedHours.forEach((hours, dateKey) => {
    const count = hours.size;
    const daySlots = opSlotsByDate.get(dateKey) || count || 1;
    cost += (pricePerDay / daySlots) * count;
  });
  return cost;
}

function getLocationStepsCompleted(loc: LocationConfig): number {
  let count = 0;
  if (loc.startDate && loc.endDate) count++;
  let h = 0;
  loc.selectedHours.forEach(s => h += s.size);
  if (h > 0) count++;
  if (loc.creativeFiles.length > 0) count++;
  return count;
}

function getFirstIncompleteStep(loc: LocationConfig): number {
  if (!loc.startDate || !loc.endDate) return 1;
  let h = 0;
  loc.selectedHours.forEach(s => h += s.size);
  if (h === 0) return 2;
  if (loc.creativeFiles.length === 0) return 3;
  return 1;
}

function getLocationMissing(loc: LocationConfig, t: (k: string) => string): string[] {
  const missing: string[] = [];
  if (!loc.startDate || !loc.endDate) missing.push(t('missingDates'));
  let h = 0;
  loc.selectedHours.forEach(s => h += s.size);
  if (h === 0) missing.push(t('missingSchedule'));
  if (loc.creativeFiles.length === 0) missing.push(t('missingCreative'));
  return missing;
}

function getLocationDateLabel(loc: LocationConfig): string {
  if (!loc.startDate || !loc.endDate) return '';
  try {
    const s = format(parseISO(loc.startDate), 'MMM d');
    const e = format(parseISO(loc.endDate), 'MMM d');
    return `${s} – ${e}`;
  } catch { return ''; }
}

/* ───────────── Responsive hook ───────────── */
function useIsDesktop(breakpoint = 1024) {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= breakpoint : true
  );
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isDesktop;
}

/* ───────────── Location Config Form (shared between layouts) ───────────── */
interface LocationFormProps {
  loc: LocationConfig;
  idx: number;
  locations: LocationConfig[];
  updateLocation: (idx: number, partial: Partial<LocationConfig>) => void;
  fetchAvailability: (idx: number, spaceId: number, sd: string, ed: string) => void;
  copySettings: (fromIdx: number, toIdx: number) => void;
  tomorrow: string;
  t: (key: string, opts?: any) => string;
}

function LocationConfigForm({ loc, idx, locations, updateLocation, fetchAvailability, copySettings, tomorrow, t }: LocationFormProps) {
  if (loc.isLoadingSpace) {
    return <Loader variant="inline" />;
  }

  return (
    <>
      {/* Copy settings */}
      <CopySettingsBtn idx={idx} locations={locations} copySettings={copySettings} t={t} />

      {/* Date Range */}
      <DateRangePicker
        startDate={loc.startDate}
        endDate={loc.endDate}
        onStartDateChange={(d) => updateLocation(idx, { startDate: d })}
        onEndDateChange={(d) => updateLocation(idx, { endDate: d })}
        loading={loc.isLoadingAvailability}
        hideHeader
      />

      {/* Schedule */}
      {loc.availability.length > 0 && (
        <ScheduleSelector
          availability={loc.availability}
          selectedDayDates={loc.selectedDayDates}
          selectedHours={loc.selectedHours}
          onDayDatesChange={(days) => updateLocation(idx, { selectedDayDates: days })}
          onHoursChange={(hours) => updateLocation(idx, { selectedHours: hours })}
          loading={loc.isLoadingAvailability}
          hideHeader
          summaryNode={
            <div className="bf-spotlight-selection-summary">
              <span>{t('selectionSummary', { days: getLocationDays(loc), hours: getLocationHours(loc) })}</span>
              <span>&#8362;{getLocationCost(loc).toFixed(2)}</span>
            </div>
          }
        />
      )}

      {/* Creative Upload */}
      <CreativeUploader
        creativeFiles={loc.creativeFiles}
        onFilesChange={(files) => updateLocation(idx, { creativeFiles: files })}
        notes={loc.notes}
        onNotesChange={(notes) => updateLocation(idx, { notes })}
      />
    </>
  );
}

/* ───────────── Status badge component ───────────── */
function StatusBadge({ status, t }: { status: 'complete' | 'incomplete' | 'not_started'; t: (key: string) => string }) {
  if (status === 'complete') {
    return (
      <span className="abf-status-badge abf-status-complete">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t('locationComplete')}
      </span>
    );
  }
  if (status === 'incomplete') {
    return (
      <span className="abf-status-badge abf-status-incomplete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {t('locationIncomplete')}
      </span>
    );
  }
  return (
    <span className="abf-status-badge abf-status-not-started">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/></svg>
      {t('locationNotStarted')}
    </span>
  );
}

/* ───────────── Copy settings sheet (bottom-to-top modal) ───────────── */
function CopySettingsSheet({ idx, locations, copySettings, onClose, t }: {
  idx: number; locations: LocationConfig[]; copySettings: (from: number, to: number) => void;
  onClose: () => void; t: (k: string, opts?: any) => string;
}) {
  const sheetStartY = useRef(0);
  const completeSources = locations
    .map((loc, i) => ({ loc, i }))
    .filter(({ loc, i }) => i !== idx && isLocationComplete(loc));

  const [targetAvail, setTargetAvail] = useState<DayAvailability[] | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(true);

  useEffect(() => {
    const target = locations[idx];
    if (completeSources.length === 0) { setLoadingAvail(false); return; }

    const allStarts = completeSources.map(s => s.loc.startDate).filter(Boolean).sort();
    const allEnds = completeSources.map(s => s.loc.endDate).filter(Boolean).sort();
    const minStart = allStarts[0];
    const maxEnd = allEnds[allEnds.length - 1];
    if (!minStart || !maxEnd) { setLoadingAvail(false); return; }

    getAvailability(target.spaceId, minStart, maxEnd)
      .then(data => setTargetAvail(data))
      .catch(() => setTargetAvail(null))
      .finally(() => setLoadingAvail(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function computePreviewHours(source: LocationConfig): number {
    if (!targetAvail) return 0;
    const sourceHoursByDow = new Map<number, Set<string>>();
    for (const [dateKey, hours] of source.selectedHours) {
      const dow = new Date(dateKey).getDay();
      if (!sourceHoursByDow.has(dow)) sourceHoursByDow.set(dow, new Set());
      for (const h of hours) sourceHoursByDow.get(dow)!.add(h);
    }
    const sourceDows = new Set<number>();
    for (const d of source.selectedDayDates) sourceDows.add(new Date(d).getDay());

    let total = 0;
    for (const day of targetAvail) {
      if (!sourceDows.has(day.day_of_week)) continue;
      const tpl = sourceHoursByDow.get(day.day_of_week);
      if (!tpl) continue;
      const targetSlots = generateHourSlots(day);
      const availableHours = new Set(targetSlots.filter(s => s.available).map(s => s.hour));
      for (const h of tpl) {
        if (availableHours.has(h)) total++;
      }
    }
    return total;
  }

  return (
    <>
      <div className="bf-dup-overlay" onClick={onClose} />
      <div className="bf-dup-sheet open">
        <div className="bf-dup-sheet-handle"
          onTouchStart={e => { sheetStartY.current = e.touches[0].clientY; }}
          onTouchEnd={e => { if (e.changedTouches[0].clientY - sheetStartY.current > 80) onClose(); }}
        >
          <div className="bf-dup-sheet-handle-bar" />
        </div>

        <div className="bf-dup-sheet-content">
          <div className="bf-campaign-header">
            <h2>{t('copySettingsFrom')}</h2>
          </div>

          <div className="abf-copy-sheet-list">
            {completeSources.map(({ loc: source, i }) => {
              const name = source.space?.name || `Space ${source.spaceId}`;
              const city = source.space?.city || '';
              const dateLabel = getLocationDateLabel(source);
              const sourceHours = getLocationHours(source);
              const previewHours = targetAvail ? computePreviewHours(source) : null;
              const isDisabled = !loadingAvail && previewHours === 0;
              const cost = getLocationCost(source);
              const imgUrl = source.space?.images?.[0]?.image_url
                ? `${API_URL}${source.space.images[0].image_url}` : null;

              return (
                <button key={i}
                  className={`abf-copy-sheet-card${isDisabled ? ' abf-copy-sheet-card-disabled' : ''}`}
                  disabled={isDisabled}
                  onClick={() => { copySettings(i, idx); onClose(); }}>
                  <div className="abf-copy-sheet-card-img">
                    {imgUrl ? <img src={imgUrl} alt={name} /> : <div className="abf-copy-sheet-card-img-ph" />}
                  </div>
                  <div className="abf-copy-sheet-card-body">
                    <span className="abf-copy-sheet-card-name">{name}</span>
                    {city && <span className="abf-copy-sheet-card-city">{city}</span>}
                    <div className="abf-copy-sheet-card-tags">
                      <span className="abf-copy-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {dateLabel}
                      </span>
                      <span className="abf-copy-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {loadingAvail
                          ? <span className="abf-copy-tag-loading" />
                          : previewHours !== null
                            ? <>{previewHours}h {t('of')} {sourceHours}h</>
                            : <>{sourceHours}h</>}
                      </span>
                    </div>
                    {source.creativeFiles.length > 0 && (
                      <div className="abf-copy-sheet-card-media">
                        {source.creativeFiles.slice(0, 4).map((file, fi) => (
                          <div key={fi} className="abf-copy-sheet-thumb">
                            {file.type.startsWith('image/')
                              ? <img src={URL.createObjectURL(file)} alt="" />
                              : file.type.startsWith('video/')
                                ? <video src={URL.createObjectURL(file)} muted />
                                : <span className="abf-copy-sheet-thumb-file">{file.name.split('.').pop()}</span>}
                          </div>
                        ))}
                        {source.creativeFiles.length > 4 && (
                          <span className="abf-copy-sheet-thumb-more">+{source.creativeFiles.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="abf-copy-sheet-card-price">&#8362;{cost.toFixed(2)}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bf-dup-sheet-bottom">
          <button className="bf-btn bf-btn-ghost" onClick={onClose}>{t('cancel', { ns: 'common' })}</button>
        </div>
      </div>
    </>
  );
}

/* ───────────── Copy settings button (styled like simple flow's "Duplicate" btn) ───────────── */
function CopySettingsBtn({ idx, locations, copySettings, t }: { idx: number; locations: LocationConfig[]; copySettings: (from: number, to: number) => void; t: (k: string, opts?: any) => string }) {
  const [open, setOpen] = useState(false);
  const hasSource = locations.some((other, i) => i !== idx && isLocationComplete(other));
  if (!hasSource) return null;
  return (
    <>
      <button type="button" className="bf-rv-add-space-btn" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        {t('copySettingsFrom')}
      </button>
      {open && <CopySettingsSheet idx={idx} locations={locations}
        copySettings={copySettings} onClose={() => setOpen(false)} t={t} />}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export default function AdvancedBookingFlow() {
  const { t } = useTranslation('orders');
  const navigate = useNavigate();
  const { spaces: campaignSpaces, clear: clearCampaign } = useCampaignContext();
  const isDesktop = useIsDesktop();

  const [locations, setLocations] = useState<LocationConfig[]>(() => {
    if (campaignSpaces.length === 0) return [];
    return campaignSpaces.map(space => ({
      spaceId: space.id,
      space,
      startDate: '',
      endDate: '',
      availability: [],
      selectedDayDates: new Set<string>(),
      selectedHours: new Map<string, Set<string>>(),
      creativeFiles: [],
      notes: '',
      isLoadingAvailability: false,
      isLoadingSpace: false,
    }));
  });
  const [selectedIdx, setSelectedIdx] = useState(0);         // desktop: which location in detail pane
  const [mobileEditIdx, setMobileEditIdx] = useState<number | null>(null); // mobile: fullscreen edit
  const [mobileSlideDir, setMobileSlideDir] = useState<'in' | 'out' | null>(null);
  const [mobileConfigStep, setMobileConfigStep] = useState(1); // 1=Dates, 2=Schedule, 3=Upload
  const [desktopConfigSteps, setDesktopConfigSteps] = useState<Map<number, number>>(() => new Map([[0, 1]]));
  const [openTabs, setOpenTabs] = useState<number[]>([0]); // location indices opened as tabs
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardDir, setWizardDir] = useState<'forward' | 'back' | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState('');
  const [detailFadeKey, setDetailFadeKey] = useState(0);     // desktop: trigger fade on switch

  // Success state
  const [createdOrders, setCreatedOrders] = useState<{ spaceName: string; ref: string; hours: number; cost: number; image: string | null; city: string }[]>([]);

  const tomorrow = format(addDays(startOfDay(new Date()), 1), 'yyyy-MM-dd');

  /* ─── Redirect if no spaces in context (direct URL visit / refresh) ─── */
  useEffect(() => {
    if (campaignSpaces.length === 0) {
      navigate('/create-campaign', { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Fetch availability ─── */
  const fetchAvailability = useCallback((idx: number, spaceId: number, sd: string, ed: string) => {
    if (!sd || !ed || sd < tomorrow || ed < sd) return;
    setLocations(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], isLoadingAvailability: true };
      return next;
    });
    getAvailability(spaceId, sd, ed).then(data => {
      setLocations(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], availability: data, selectedDayDates: new Set(), selectedHours: new Map(), isLoadingAvailability: false };
        return next;
      });
    }).catch(() => {
      setLocations(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], isLoadingAvailability: false };
        return next;
      });
      setError(t('fetchAvailabilityFailed'));
    });
  }, [tomorrow, t]);

  /* ─── Auto-fetch availability when dates change ─── */
  const fetchedDatesRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    locations.forEach((loc, idx) => {
      if (!loc.startDate || !loc.endDate) return;
      if (loc.startDate < tomorrow || loc.endDate < loc.startDate) return;
      const key = `${loc.spaceId}_${loc.startDate}_${loc.endDate}`;
      if (fetchedDatesRef.current.get(idx) === key) return;
      fetchedDatesRef.current.set(idx, key);
      fetchAvailability(idx, loc.spaceId, loc.startDate, loc.endDate);
    });
  }, [locations, tomorrow, fetchAvailability]);

  const updateLocation = useCallback((idx: number, partial: Partial<LocationConfig>) => {
    setLocations(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...partial };
      return next;
    });
  }, []);

  /* ─── Copy settings ─── */
  const copySettings = useCallback((fromIdx: number, toIdx: number) => {
    const source = locations[fromIdx];
    if (!source) return;
    setLocations(prev => {
      const next = [...prev];
      next[toIdx] = { ...next[toIdx], startDate: source.startDate, endDate: source.endDate, creativeFiles: [...source.creativeFiles], notes: source.notes };
      return next;
    });
    if (source.startDate && source.endDate) {
      const targetSpaceId = locations[toIdx].spaceId;
      // Mark as fetched so useEffect doesn't re-trigger
      fetchedDatesRef.current.set(toIdx, `${targetSpaceId}_${source.startDate}_${source.endDate}`);
      setLocations(prev => {
        const next = [...prev];
        next[toIdx] = { ...next[toIdx], isLoadingAvailability: true };
        return next;
      });
      getAvailability(targetSpaceId, source.startDate, source.endDate).then(data => {
        const sourceHoursByDow = new Map<number, Set<string>>();
        for (const [dateKey, hours] of source.selectedHours) {
          const dow = new Date(dateKey).getDay();
          if (!sourceHoursByDow.has(dow)) sourceHoursByDow.set(dow, new Set());
          for (const h of hours) sourceHoursByDow.get(dow)!.add(h);
        }
        const sourceDows = new Set<number>();
        for (const date of source.selectedDayDates) sourceDows.add(new Date(date).getDay());
        const newDayDates = new Set<string>();
        const newHours = new Map<string, Set<string>>();
        for (const day of data) {
          if (sourceDows.has(day.day_of_week)) {
            const tpl = sourceHoursByDow.get(day.day_of_week);
            if (tpl) {
              const targetSlots = generateHourSlots(day);
              const availableHours = new Set(targetSlots.filter(s => s.available).map(s => s.hour));
              const filtered = new Set([...tpl].filter(h => availableHours.has(h)));
              if (filtered.size > 0) {
                newDayDates.add(day.date);
                newHours.set(day.date, filtered);
              }
            }
          }
        }
        setLocations(prev => {
          const next = [...prev];
          next[toIdx] = { ...next[toIdx], availability: data, selectedDayDates: newDayDates, selectedHours: newHours, isLoadingAvailability: false };
          return next;
        });
      }).catch(() => {
        setLocations(prev => {
          const next = [...prev];
          next[toIdx] = { ...next[toIdx], isLoadingAvailability: false };
          return next;
        });
      });
    }
  }, [locations]);

  /* ─── Wizard navigation ─── */
  const goToWizardStep = (target: number) => {
    setWizardDir(target > wizardStep ? 'forward' : 'back');
    setWizardStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const completedCount = locations.filter(isLocationComplete).length;
  const allComplete = completedCount === locations.length && locations.length > 0;

  /* ─── Submit ─── */
  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    const created: typeof createdOrders = [];
    try {
      setSubmitProgress(t('creating'));
      const campaign = await createCampaign({ campaign_type: 'long_term' });
      const campaignId = campaign.id;
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        if (!isLocationComplete(loc)) continue;
        setSubmitProgress(t('creatingOrders', { current: i + 1, total: locations.length }));
        const days: SelectedDay[] = [];
        loc.selectedHours.forEach((hours, dateKey) => {
          if (hours.size > 0) days.push({ date: dateKey, time_ranges: getTimeRangesForDay(loc.selectedHours, dateKey) });
        });
        const order = await createOrder({
          space_id: loc.spaceId,
          booking_type: 'long_term',
          start_date: loc.startDate,
          end_date: loc.endDate,
          selected_days: days,
          notes: loc.notes || undefined,
          campaign_id: campaignId,
        });
        setSubmitProgress(t('uploadingCreatives'));
        for (const file of loc.creativeFiles) await uploadCreative(order.id, file, () => {});
        created.push({
          spaceName: loc.space?.name || '',
          ref: order.reference_number,
          hours: getLocationHours(loc),
          cost: getLocationCost(loc),
          image: loc.space?.images?.[0]?.image_url || null,
          city: loc.space?.city || '',
        });
      }
      setSubmitProgress(t('finalizingCampaign'));
      try { await finalizeCampaign(campaignId); } catch { /* non-critical */ }
      setCreatedOrders(created);
      goToWizardStep(3);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (detail?.message ?? null);
      setError(typeof msg === 'string' ? msg : t('bookingFailed'));
    } finally {
      setSubmitting(false);
      setSubmitProgress('');
    }
  };

  /* ─── Computed ─── */
  const totalSteps = 3;
  const reviewCards = locations.map(loc => {
    const r = parseImpressionRange(loc.space?.estimated_daily_impressions);
    let cardMinEyes = 0, cardMaxEyes = 0;
    if (r.max > 0) {
      const opSlotsByDate = new Map<string, number>();
      for (const day of loc.availability) {
        if (day.operating_hours) {
          const sH = Math.ceil(parseTimeDecimal(day.operating_hours.start_time));
          const eH = Math.floor(parseTimeDecimal(day.operating_hours.end_time));
          opSlotsByDate.set(day.date, Math.max(eH - sH, 1));
        }
      }
      loc.selectedHours.forEach((hours, dateKey) => {
        const booked = hours.size;
        const opH = opSlotsByDate.get(dateKey) || booked || 1;
        cardMinEyes += (booked / opH) * r.min;
        cardMaxEyes += (booked / opH) * r.max;
      });
      cardMinEyes = roundExposure(cardMinEyes);
      cardMaxEyes = roundExposure(cardMaxEyes);
    }
    return {
      name: loc.space?.name || '',
      city: loc.space?.city || '',
      image: loc.space?.images?.[0]?.image_url || null,
      hours: getLocationHours(loc),
      cost: getLocationCost(loc),
      startDate: loc.startDate,
      endDate: loc.endDate,
      selectedHours: loc.selectedHours,
      minEyes: cardMinEyes,
      maxEyes: cardMaxEyes,
    };
  });
  const totalHours = reviewCards.reduce((s, c) => s + c.hours, 0);
  const totalCost = reviewCards.reduce((s, c) => s + c.cost, 0);

  /* ─── Shared form props builder ─── */
  const formProps = (idx: number): LocationFormProps => ({
    loc: locations[idx],
    idx,
    locations,
    updateLocation,
    fetchAvailability,
    copySettings,
    tomorrow,
    t,
  });

  /* ─── Desktop: read/write per-tab config step ─── */
  const desktopConfigStep = desktopConfigSteps.get(selectedIdx) ?? 1;
  const setDesktopConfigStep = (valOrFn: number | ((prev: number) => number)) => {
    setDesktopConfigSteps(prev => {
      const next = new Map(prev);
      const cur = prev.get(selectedIdx) ?? 1;
      next.set(selectedIdx, typeof valOrFn === 'function' ? valOrFn(cur) : valOrFn);
      return next;
    });
  };

  /* ─── Desktop: select a location in left panel ─── */
  const selectLocation = (idx: number) => {
    if (idx === selectedIdx) return;
    setDetailFadeKey(k => k + 1);
    setSelectedIdx(idx);
    // Add to open tabs if not already there, and initialize its step
    setOpenTabs(prev => prev.includes(idx) ? prev : [...prev, idx]);
    setDesktopConfigSteps(prev => {
      if (prev.has(idx)) return prev;
      const next = new Map(prev);
      next.set(idx, getFirstIncompleteStep(locations[idx]));
      return next;
    });
  };

  /* ─── Desktop: close a space tab ─── */
  const closeTab = (idx: number) => {
    const remaining = openTabs.filter(i => i !== idx);
    if (remaining.length === 0) return; // can't close last tab
    setOpenTabs(remaining);
    if (selectedIdx === idx) {
      setSelectedIdx(remaining[remaining.length - 1]);
      setDetailFadeKey(k => k + 1);
    }
  };

  /* ─── Remove a location from the campaign ─── */
  const removeLocation = useCallback((idx: number) => {
    if (locations.length <= 1) return; // can't remove last location

    setLocations(prev => prev.filter((_, i) => i !== idx));

    // Adjust desktop index-based state after removal
    setSelectedIdx(prev => {
      if (prev === idx) return Math.max(0, idx - 1);
      return prev > idx ? prev - 1 : prev;
    });
    setDetailFadeKey(k => k + 1);

    // Remap openTabs: remove the idx, shift indices above it down by 1
    setOpenTabs(prev => {
      const remapped = prev.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
      return remapped.length > 0 ? remapped : [0];
    });

    // Remap desktopConfigSteps
    setDesktopConfigSteps(prev => {
      const next = new Map<number, number>();
      prev.forEach((step, key) => {
        if (key === idx) return;
        next.set(key > idx ? key - 1 : key, step);
      });
      return next;
    });

    // Close mobile edit if the removed location was being edited
    if (mobileEditIdx === idx) {
      setMobileSlideDir('out');
      setTimeout(() => {
        setMobileEditIdx(null);
        setMobileSlideDir(null);
        setMobileConfigStep(1);
      }, 250);
    } else if (mobileEditIdx !== null && mobileEditIdx > idx) {
      setMobileEditIdx(mobileEditIdx - 1);
    }
  }, [locations.length, t, mobileEditIdx]);

  /* ─── Mobile: open/close fullscreen edit ─── */
  const openMobileEdit = (idx: number) => {
    setMobileConfigStep(getFirstIncompleteStep(locations[idx]));
    setMobileSlideDir('in');
    setMobileEditIdx(idx);
  };
  const closeMobileEdit = () => {
    setMobileSlideDir('out');
    setTimeout(() => {
      setMobileEditIdx(null);
      setMobileSlideDir(null);
      setMobileConfigStep(1);
    }, 250);
  };

  /* ─── Empty state (redirect will fire via useEffect) ─── */
  if (locations.length === 0) {
    return (
      <div className="bf-page bf-wizard-page">
        <div className="bf-loading"><Loader variant="page" /></div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="bf-page bf-wizard-page">
      {/* Top navigation — hidden on mobile when editing a location */}
      <div className={`bf-top-nav${mobileEditIdx !== null ? ' abf-hide-mobile' : ''}`}>
        {wizardStep < 3 && (
          <button className="bf-header-back" onClick={() => {
            if (wizardStep > 1) { goToWizardStep(wizardStep - 1); return; }
            navigate('/create-campaign?step=mode');
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
        )}
        {wizardStep === 1 && (
          <span className="abf-top-title">{t('configureXofY', { done: completedCount, total: locations.length })}</span>
        )}
        {wizardStep === 1 && <span className="abf-top-title-spacer" />}
      </div>

      {/* ═══════ STEP 1 — Configure ═══════ */}
      {wizardStep === 1 && (
        <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>

          {/* ─────── DESKTOP: Master–Detail ─────── */}
          {isDesktop ? (
            <div className="abf-master-detail">
              {/* Left panel — location list */}
              <div className="abf-master-panel">
                <div className="abf-sidebar-header">
                  <button className="abf-sidebar-back" onClick={() => navigate('/create-campaign?step=mode')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
                  </button>
                  <span className="abf-sidebar-title">
                    {t('configureXofY', { done: completedCount, total: locations.length })}
                  </span>
                </div>
                <div className="abf-master-list">
                  {locations.map((loc, idx) => {
                    const status = getLocationStatus(loc);
                    const spaceName = loc.space?.name || `Space ${loc.spaceId}`;
                    const spaceCity = loc.space?.city || '';
                    const spaceImage = loc.space?.images?.[0]?.image_url || null;
                    const isActive = selectedIdx === idx;

                    return (
                      <div key={loc.spaceId} className={`abf-master-item-wrap${isActive ? ' active' : ''}`}>
                        <button
                          type="button"
                          className={`abf-master-item${isActive ? ' active' : ''}`}
                          onClick={() => selectLocation(idx)}
                        >
                          <div className="abf-master-item-img">
                            {spaceImage ? (
                              <img src={`${API_URL}${spaceImage}`} alt={spaceName} />
                            ) : (
                              <div className="abf-master-item-img-ph" />
                            )}
                          </div>
                          <div className="abf-master-item-info">
                            <span className="abf-master-item-name">{spaceName}</span>
                            {spaceCity && <span className="abf-master-item-city">{spaceCity}</span>}
                            <StatusBadge status={status} t={t} />
                          </div>
                        </button>
                        {locations.length > 1 && (
                          <button
                            type="button"
                            className="abf-master-item-remove"
                            title={t('removeSpace')}
                            onClick={(e) => { e.stopPropagation(); removeLocation(idx); }}
                          >
                            <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Campaign summary pinned to bottom of sidebar */}
                <div className="abf-sidebar-summary">
                  <div className="abf-sidebar-summary-title">{t('sidebarCampaignSummary')}</div>
                  <div className="abf-sidebar-summary-row">
                    <span className="abf-sidebar-summary-label">{t('spacesLabel')}</span>
                    <span className="abf-sidebar-summary-value">{completedCount} / {locations.length}</span>
                  </div>
                  <div className="abf-sidebar-summary-row">
                    <span className="abf-sidebar-summary-label">{t('totalHoursLabelSidebar')}</span>
                    <span className="abf-sidebar-summary-value">{totalHours}h</span>
                  </div>
                  <div className="abf-sidebar-summary-row abf-sidebar-summary-total">
                    <span className="abf-sidebar-summary-label">{t('estimatedTotal')}</span>
                    <span className="abf-sidebar-summary-value">&#8362;{totalCost.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Right panel — detail form (same layout as mobile edit) */}
              <div className="abf-detail-panel">
                {locations[selectedIdx] && (
                  <div key={detailFadeKey} className="abf-detail-content abf-detail-fade-in">
                    {/* Space tab strip */}
                    <div className="abf-space-tabs">
                      {openTabs.map(tabIdx => {
                        const loc = locations[tabIdx];
                        const name = loc.space?.name || `Space ${loc.spaceId}`;
                        const status = getLocationStatus(loc);
                        const isActive = selectedIdx === tabIdx;
                        return (
                          <button
                            key={tabIdx}
                            type="button"
                            className={`abf-space-tab${isActive ? ' active' : ''}`}
                            onClick={() => { setSelectedIdx(tabIdx); setDetailFadeKey(k => k + 1); }}
                          >
                            {status === 'complete' && (
                              <svg viewBox="0 0 16 16" fill="none" width="11" height="11" className="abf-space-tab-check"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            )}
                            <span className="abf-space-tab-name">{name}</span>
                            {openTabs.length > 1 && (
                              <span className="abf-space-tab-close" onClick={e => { e.stopPropagation(); closeTab(tabIdx); }}>×</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Duplicate button row + Tab strip */}
                    <div className="abf-detail-toolbar">
                      <div className="abf-edit-tabs">
                        {[
                          { step: 1, label: t('stepDates') },
                          { step: 2, label: t('stepSchedule') },
                          { step: 3, label: t('stepUpload') },
                        ].map(({ step, label }) => {
                          const loc = locations[selectedIdx];
                          const step1Done = !!(loc.startDate && loc.endDate && loc.availability.length > 0);
                          const step2Done = getLocationHours(loc) > 0;
                          const done = step === 1 ? step1Done
                            : step === 2 ? step2Done
                            : loc.creativeFiles.length > 0;
                          const locked = step === 2 ? !step1Done : step === 3 ? !step2Done : false;
                          return (
                            <button
                              key={step}
                              type="button"
                              disabled={locked}
                              className={`abf-edit-tab${desktopConfigStep === step ? ' abf-edit-tab--active' : ''}${done ? ' abf-edit-tab--done' : ''}${locked ? ' abf-edit-tab--locked' : ''}`}
                              onClick={() => { if (!locked) setDesktopConfigStep(step); }}
                            >
                              <span className="abf-edit-tab-num">{done
                                ? <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                : locked
                                ? <svg viewBox="0 0 16 16" fill="none" width="10" height="10"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                : step
                              }</span>
                              <span className="abf-edit-tab-label">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <CopySettingsBtn idx={selectedIdx} locations={locations} copySettings={copySettings} t={t} />
                    </div>

                    {/* Body — scrollable, one section at a time */}
                    <div className="abf-detail-step-body">
                      {(() => {
                        const loc = locations[selectedIdx];
                        const idx = selectedIdx;

                        if (loc.isLoadingSpace) return <Loader variant="inline" />;

                        if (desktopConfigStep === 1) {
                          return (
                            <>
                              <DateRangePicker
                                startDate={loc.startDate}
                                endDate={loc.endDate}
                                onStartDateChange={(d) => updateLocation(idx, { startDate: d })}
                                onEndDateChange={(d) => updateLocation(idx, { endDate: d })}
                                loading={loc.isLoadingAvailability}
                                hideHeader
                              />
                            </>
                          );
                        }

                        if (desktopConfigStep === 2) {
                          if (loc.availability.length === 0) {
                            return (
                              <div className="abf-empty-step">
                                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="40" height="40"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                <p>{t('pickDatesFirst')}</p>
                                <button type="button" className="bf-btn bf-btn-confirm" style={{ marginTop: 8 }} onClick={() => setDesktopConfigStep(1)}>
                                  {t('stepDates')}
                                </button>
                              </div>
                            );
                          }
                          return (
                            <ScheduleSelector
                              availability={loc.availability}
                              selectedDayDates={loc.selectedDayDates}
                              selectedHours={loc.selectedHours}
                              onDayDatesChange={(days) => updateLocation(idx, { selectedDayDates: days })}
                              onHoursChange={(hours) => updateLocation(idx, { selectedHours: hours })}
                              loading={loc.isLoadingAvailability}
                              hideHeader
                              summaryNode={
                                <div className="bf-spotlight-selection-summary">
                                  <span>{t('selectionSummary', { days: getLocationDays(loc), hours: getLocationHours(loc) })}</span>
                                  <span>&#8362;{getLocationCost(loc).toFixed(2)}</span>
                                </div>
                              }
                            />
                          );
                        }

                        /* Step 3 — Upload */
                        return (
                          <CreativeUploader
                            creativeFiles={loc.creativeFiles}
                            onFilesChange={(files) => updateLocation(idx, { creativeFiles: files })}
                            notes={loc.notes}
                            onNotesChange={(notes) => updateLocation(idx, { notes })}
                          />
                        );
                      })()}
                    </div>

                    {/* Desktop detail action button */}
                    {(() => {
                      const loc = locations[selectedIdx];
                      const step1Done = !!(loc.startDate && loc.endDate && loc.availability.length > 0);
                      const step2Done = getLocationHours(loc) > 0;
                      const canAdvance = desktopConfigStep === 1 ? step1Done : desktopConfigStep === 2 ? step2Done : true;

                      if (desktopConfigStep < 3) {
                        const stepLabel = desktopConfigStep === 1
                          ? t('continueToSchedule')
                          : t('continueToUpload');
                        return (
                          <button
                            type="button"
                            className="bf-btn bf-btn-confirm abf-step-next-btn"
                            disabled={!canAdvance}
                            onClick={() => setDesktopConfigStep(s => s + 1)}
                          >
                            {stepLabel}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                          </button>
                        );
                      }
                      const hasMedia = loc.creativeFiles.length > 0;
                      // If this is the last incomplete location, hide Save & Back — the bottom bar Next handles it
                      const otherAllComplete = locations.every((l, i) => i === selectedIdx || isLocationComplete(l));
                      const isLastLocation = otherAllComplete && hasMedia && step1Done && step2Done;
                      if (isLastLocation) return null;

                      return (
                        <button
                          type="button"
                          className="bf-btn bf-btn-confirm abf-step-next-btn"
                          disabled={!hasMedia}
                          onClick={() => {
                            const nextIdx = locations.findIndex((l, i) => i !== selectedIdx && !isLocationComplete(l));
                            if (nextIdx !== -1) {
                              selectLocation(nextIdx);
                            }
                          }}
                        >
                          {t('saveAndBack')}
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ─────── MOBILE: List + Fullscreen Edit ─────── */
            <>
              {mobileEditIdx === null ? (
                /* Location List Screen */
                <div className="bf-section bf-animate-in">
                  <h2 className="bf-step-title">{t('configureLocations')}</h2>
                  <p className="bf-step-desc">{t('configureLocationsDesc')}</p>

                  {/* Top progress bar */}
                  <div className="abf-top-progress">
                    <div className="abf-top-progress-track">
                      <div
                        className="abf-top-progress-fill"
                        style={{ width: `${locations.length > 0 ? (completedCount / locations.length) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="abf-top-progress-label">
                      {completedCount} / {locations.length}
                    </span>
                  </div>

                  <div className="abf-mobile-list">
                    {locations.map((loc, idx) => {
                      const status = getLocationStatus(loc);
                      const spaceName = loc.space?.name || `Space ${loc.spaceId}`;
                      const spaceCity = loc.space?.city || '';
                      const spaceImage = loc.space?.images?.[0]?.image_url || null;
                      const hours = getLocationHours(loc);
                      const missing = getLocationMissing(loc, t);
                      const dateLabel = getLocationDateLabel(loc);
                      const stepsComplete = getLocationStepsCompleted(loc);

                      return (
                        <div key={loc.spaceId} className="abf-mobile-card-wrap">
                          <button
                            type="button"
                            className={`abf-mobile-card abf-mobile-card--${status}`}
                            onClick={() => openMobileEdit(idx)}
                          >
                            <div className="abf-mobile-card-main">
                              <div className="abf-mobile-card-img">
                                {spaceImage ? (
                                  <img src={`${API_URL}${spaceImage}`} alt={spaceName} />
                                ) : (
                                  <div className="abf-mobile-card-img-ph" />
                                )}
                                {status === 'complete' && (
                                  <span className="abf-mobile-card-check">
                                    <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M3 8.5l3.5 3.5L13 5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </span>
                                )}
                              </div>
                              <div className="abf-mobile-card-body">
                                <div className="abf-mobile-card-row-top">
                                  <span className="abf-mobile-card-name">{spaceName}</span>
                                </div>
                                {spaceCity && <span className="abf-mobile-card-city">{spaceCity}</span>}
                                {/* Summary line */}
                                {status === 'complete' ? (
                                  <span className="abf-mobile-card-summary">
                                    {dateLabel && <>{dateLabel} · </>}{hours}h · {loc.creativeFiles.length} file{loc.creativeFiles.length !== 1 ? 's' : ''}
                                  </span>
                                ) : status === 'incomplete' ? (
                                  <div className="abf-mobile-card-steps-row">
                                    <span className="abf-step-dots">
                                      {[1, 2, 3].map(s => (
                                        <span key={s} className={`abf-step-dot${s <= stepsComplete ? ' abf-step-dot--done' : ''}`} />
                                      ))}
                                    </span>
                                    <span className="abf-mobile-card-hint">
                                      {stepsComplete}/3 · {missing[0]}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="abf-mobile-card-hint abf-mobile-card-hint--neutral">
                                    {t('tapToConfigure')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="abf-mobile-card-badge-row">
                              <StatusBadge status={status} t={t} />
                            </div>
                          </button>
                          {locations.length > 1 && (
                            <button
                              type="button"
                              className="abf-mobile-card-remove"
                              onClick={(e) => { e.stopPropagation(); removeLocation(idx); }}
                            >
                              <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Fullscreen Edit Screen — inner 3-step wizard */
                <div className={`abf-mobile-edit${mobileSlideDir === 'in' ? ' abf-slide-in' : mobileSlideDir === 'out' ? ' abf-slide-out' : ''}`}>
                  {/* Header */}
                  <div className="abf-mobile-edit-header">
                    <button type="button" className="abf-mobile-edit-back" onClick={() => {
                      if (mobileConfigStep > 1) { setMobileConfigStep(s => s - 1); return; }
                      closeMobileEdit();
                    }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
                    </button>
                    <span className="abf-mobile-edit-title">
                      {locations[mobileEditIdx]?.space?.name || `Space ${locations[mobileEditIdx]?.spaceId}`}
                    </span>
                    <div className="abf-mobile-edit-actions">
                      <CopySettingsBtn idx={mobileEditIdx!} locations={locations} copySettings={copySettings} t={t} />
                    </div>
                  </div>

                  {/* Step tabs */}
                  <div className="abf-edit-tabs">
                    {[
                      { step: 1, label: t('stepDates') },
                      { step: 2, label: t('stepSchedule') },
                      { step: 3, label: t('stepUpload') },
                    ].map(({ step, label }) => {
                      const loc = locations[mobileEditIdx!];
                      const step1Done = !!(loc?.startDate && loc?.endDate && loc?.availability.length > 0);
                      const step2Done = getLocationHours(loc) > 0;
                      const done = step === 1 ? step1Done
                        : step === 2 ? step2Done
                        : (loc?.creativeFiles.length || 0) > 0;
                      const locked = step === 2 ? !step1Done : step === 3 ? !step2Done : false;
                      return (
                        <button
                          key={step}
                          type="button"
                          disabled={locked}
                          className={`abf-edit-tab${mobileConfigStep === step ? ' abf-edit-tab--active' : ''}${done ? ' abf-edit-tab--done' : ''}${locked ? ' abf-edit-tab--locked' : ''}`}
                          onClick={() => { if (!locked) setMobileConfigStep(step); }}
                        >
                          <span className="abf-edit-tab-num">{done
                            ? <svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            : locked
                            ? <svg viewBox="0 0 16 16" fill="none" width="10" height="10"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            : step
                          }</span>
                          <span className="abf-edit-tab-label">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Body — one section at a time */}
                  <div className="abf-mobile-edit-body">
                    {locations[mobileEditIdx] && (() => {
                      const loc = locations[mobileEditIdx!];
                      const idx = mobileEditIdx!;

                      if (loc.isLoadingSpace) return <Loader variant="inline" />;

                      if (mobileConfigStep === 1) {
                        return (
                          <>
                            <DateRangePicker
                              startDate={loc.startDate}
                              endDate={loc.endDate}
                              onStartDateChange={(d) => updateLocation(idx, { startDate: d })}
                              onEndDateChange={(d) => updateLocation(idx, { endDate: d })}
                              loading={loc.isLoadingAvailability}
                              hideHeader
                            />
                          </>
                        );
                      }

                      if (mobileConfigStep === 2) {
                        if (loc.availability.length === 0) {
                          return (
                            <div className="abf-empty-step">
                              <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="40" height="40"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                              <p>{t('pickDatesFirst')}</p>
                              <button type="button" className="bf-btn bf-btn-confirm" style={{ marginTop: 8 }} onClick={() => setMobileConfigStep(1)}>
                                {t('stepDates')}
                              </button>
                            </div>
                          );
                        }
                        return (
                          <ScheduleSelector
                            availability={loc.availability}
                            selectedDayDates={loc.selectedDayDates}
                            selectedHours={loc.selectedHours}
                            onDayDatesChange={(days) => updateLocation(idx, { selectedDayDates: days })}
                            onHoursChange={(hours) => updateLocation(idx, { selectedHours: hours })}
                            loading={loc.isLoadingAvailability}
                            hideHeader
                            summaryNode={
                              <div className="bf-spotlight-selection-summary">
                                <span>{t('selectionSummary', { days: getLocationDays(loc), hours: getLocationHours(loc) })}</span>
                                <span>&#8362;{getLocationCost(loc).toFixed(2)}</span>
                              </div>
                            }
                          />
                        );
                      }

                      /* Step 3 — Upload */
                      return (
                        <CreativeUploader
                          creativeFiles={loc.creativeFiles}
                          onFilesChange={(files) => updateLocation(idx, { creativeFiles: files })}
                          notes={loc.notes}
                          onNotesChange={(notes) => updateLocation(idx, { notes })}
                        />
                      );
                    })()}
                  </div>

                  {/* Bottom bar with progress + nav */}
                  <div className="abf-mobile-edit-bottom">
                    <BottomProgressBar currentStep={mobileConfigStep} totalSteps={3} />
                    <div className="abf-mobile-edit-bottom-row">
                      {(() => {
                        const loc = locations[mobileEditIdx!];
                        const step1Done = !!(loc?.startDate && loc?.endDate && loc?.availability.length > 0);
                        const step2Done = getLocationHours(loc) > 0;
                        const canAdvance = mobileConfigStep === 1 ? step1Done : mobileConfigStep === 2 ? step2Done : true;

                        if (mobileConfigStep < 3) {
                          return (
                            <button
                              type="button"
                              className="bf-btn bf-btn-confirm"
                              disabled={!canAdvance}
                              onClick={() => setMobileConfigStep(s => s + 1)}
                            >
                              {t('continueBtn')}
                            </button>
                          );
                        }
                        const hasMedia = loc.creativeFiles.length > 0;
                        return (
                          <button
                            type="button"
                            className="bf-btn bf-btn-confirm"
                            disabled={!hasMedia}
                            onClick={closeMobileEdit}
                          >
                            {t('saveAndBack')}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════ STEP 2 — Review ═══════ */}
      {wizardStep === 2 && (
        <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
          <div className="bf-section bf-animate-in">
            <h2 className="bf-step-title">{t('reviewYourCampaign')}</h2>
            <p className="bf-step-desc">{t('reviewCampaignDesc', { spaces: locations.length, hours: totalHours, cost: totalCost.toFixed(2) })}</p>

            {(() => {
              let minEyes = 0;
              let maxEyes = 0;
              for (const loc of locations) {
                const r = parseImpressionRange(loc.space?.estimated_daily_impressions);
                if (r.max > 0) {
                  const opSlotsByDate = new Map<string, number>();
                  for (const day of loc.availability) {
                    if (day.operating_hours) {
                      const startH = Math.ceil(parseTimeDecimal(day.operating_hours.start_time));
                      const endH = Math.floor(parseTimeDecimal(day.operating_hours.end_time));
                      opSlotsByDate.set(day.date, Math.max(endH - startH, 1));
                    }
                  }
                  loc.selectedHours.forEach((hours, dateKey) => {
                    const booked = hours.size;
                    const opH = opSlotsByDate.get(dateKey) || booked || 1;
                    const ratio = booked / opH;
                    minEyes += ratio * r.min;
                    maxEyes += ratio * r.max;
                  });
                }
              }
              minEyes = roundExposure(minEyes);
              maxEyes = roundExposure(maxEyes);
              if (maxEyes === 0) return null;
              const isRange = minEyes !== maxEyes && minEyes > 0;
              return (
                <div className="bf-review-schedule" style={{ marginBottom: 16 }}>
                  <div className="bf-review-exposure" style={{ borderTop: 'none', paddingTop: 0, width: '100%' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>
                      {maxEyes > 0 && (isRange
                        ? t('estimatedExposureRange', { min: minEyes.toLocaleString(), max: maxEyes.toLocaleString() })
                        : t('estimatedExposure', { eyes: maxEyes.toLocaleString() })
                      )}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="bf-rv-cards-grid">
              {reviewCards.map((card, i) => (
                <div key={i} className="bf-rv-card">
                  <div className="bf-rv-card-top">
                    <div className="bf-rv-card-img-wrap">
                      {card.image
                        ? <img className="bf-rv-card-img" src={`${API_URL}${card.image}`} alt={card.name} />
                        : <div className="bf-rv-card-img bf-rv-card-img-ph" />
                      }
                    </div>
                    <div className="bf-rv-card-info">
                      <span className="bf-rv-card-name">{card.name}</span>
                      {card.city && <span className="bf-rv-card-city">{card.city}</span>}
                    </div>
                  </div>
                  <div className="bf-rv-card-bottom">
                    <div className="bf-rv-card-stat">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span>{card.hours}h</span>
                    </div>
                    {card.maxEyes > 0 && (
                      <div className="bf-rv-card-stat bf-rv-card-eyes">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        <span>~{card.minEyes !== card.maxEyes ? `${card.minEyes.toLocaleString()}–${card.maxEyes.toLocaleString()}` : card.maxEyes.toLocaleString()}</span>
                      </div>
                    )}
                    <span className="bf-rv-card-cost">&#8362;{card.cost.toFixed(2)}</span>
                  </div>
                  {/* Date range + segment pills row */}
                  {(() => {
                    const allHours = new Set<number>();
                    card.selectedHours.forEach(hrs => hrs.forEach(h => allHours.add(parseInt(h))));
                    const segments: string[] = [];
                    if (Array.from(allHours).some(h => h >= 5 && h < 12)) segments.push(t('segmentMorning'));
                    if (Array.from(allHours).some(h => h >= 12 && h < 16)) segments.push(t('segmentAfternoon'));
                    if (Array.from(allHours).some(h => h >= 16 || h < 5)) segments.push(t('segmentEvening'));
                    const dateLabel = `${card.startDate ? format(parse(card.startDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : '–'} – ${card.endDate ? format(parse(card.endDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : '–'}`;
                    return (
                      <div className="abf-rv-date-segments">
                        <div className="abf-rv-date-row-top">
                          <svg className="abf-rv-date-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                          <span className="abf-rv-date-label">{dateLabel}</span>
                        </div>
                        {segments.length > 0 && (
                          <>
                            <span className="abf-rv-date-sep" />
                            <div className="abf-rv-segment-pills">
                              {segments.map((seg, si) => (
                                <span key={si} className="abf-rv-segment-pill">{seg}</span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className="bf-rv-total">
              <span>{t('campaignTotal')}</span>
              <strong>&#8362;{totalCost.toFixed(2)}</strong>
            </div>

            <p className="bf-payment-note">{t('paymentNote')}</p>
          </div>
        </div>
      )}

      {/* ═══════ STEP 3 — Success ═══════ */}
      {wizardStep === 3 && (() => {
        const allCards = createdOrders;
        const allCost = allCards.reduce((s, c) => s + c.cost, 0);
        const allHours = allCards.reduce((s, c) => s + c.hours, 0);
        return (
          <div className={`bf-wizard-content ${wizardDir === 'forward' ? 'bf-wizard-in-left' : wizardDir === 'back' ? 'bf-wizard-in-right' : ''}`} onAnimationEnd={() => setWizardDir(null)}>
            <div className="bf-section bf-animate-in bf-step5-wrap">
              <div className="bf-step5-hero">
                <div className="bf-step5-hero-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <h2 className="bf-step5-hero-title">{t('advancedCampaignCreated')}</h2>
                <p className="bf-step5-hero-sub">{t('advancedCampaignSummary', { spaces: allCards.length, hours: allHours, cost: allCost.toFixed(2) })}</p>
              </div>
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
              <div className="bf-step5-cards">
                {allCards.map((card, i) => (
                  <div key={i} className="bf-step5-card">
                    <div className="bf-step5-card-img">
                      {card.image
                        ? <img src={`${API_URL}${card.image}`} alt={card.spaceName} />
                        : <div className="bf-step5-card-img-ph" />
                      }
                    </div>
                    <div className="bf-step5-card-info">
                      <span className="bf-step5-card-name">{card.spaceName}</span>
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

      {/* ═══════ Bottom Bar ═══════ */}
      {/* Hide the global bottom bar when mobile edit is open (it has its own) */}
      {mobileEditIdx === null && (
        <div className="bf-wizard-bottom-bar">
          <BottomProgressBar currentStep={wizardStep} totalSteps={totalSteps} />
          <div className="bf-wizard-bottom-inner">
            {wizardStep < 3 && wizardStep > 1 && (
              <div className="bf-wizard-bottom-row">
                {/* <button className="bf-wizard-back-btn" onClick={() => goToWizardStep(wizardStep - 1)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
                  {t('back')}
                </button> */}
                <div className="bf-bottom-cost">
                  <span className="bf-bottom-cost-amount">&#8362;{totalCost.toFixed(2)}</span>
                  <span className="bf-bottom-cost-detail">{t('spacesCountOnly', { count: locations.length })}</span>
                </div>
              </div>
            )}
            {wizardStep === 1 && (
              <button className="bf-btn bf-btn-confirm" disabled={!allComplete} onClick={() => goToWizardStep(2)}>
                {t('continueBtn')}
              </button>
            )}
            {wizardStep === 2 && (
              <button className="bf-btn bf-btn-confirm" disabled={submitting} onClick={handleSubmit}>
                {submitting
                  ? <><Loader variant="button" className="loader-light" /> {submitProgress}</>
                  : t('sendBookingRequest')
                }
              </button>
            )}
            {wizardStep === 3 && (
              <div className="bf-step5-bottom-btns">
                <button className="bf-step5-bottom-btn bf-step5-bottom-btn-outline" onClick={() => navigate('/create-campaign')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {t('startNewCampaign')}
                </button>
                <button className="bf-step5-bottom-btn bf-step5-bottom-btn-fill" onClick={() => navigate('/orders')}>
                  {t('viewMyOrders')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert onClose={() => setError('')} severity="error" icon={<ErrorOutline />} variant="filled" sx={{ borderRadius: 3, fontWeight: 600, fontSize: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>{error}</Alert>
      </Snackbar>
    </div>
  );
}
