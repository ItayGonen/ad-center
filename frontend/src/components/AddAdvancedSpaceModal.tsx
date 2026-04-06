import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Loader from './Loader';
import FluidDrawer from './FluidDrawer';
import useIsMobile from '../hooks/useIsMobile';
import DateRangePicker from './DateRangePicker';
import ScheduleSelector from './ScheduleSelector';
import CreativeUploader from './CreativeUploader';
import { getSpaces, getAvailability } from '../services/spaces';
import type { SpaceListItem, DayAvailability } from '../services/spaces';
import { createOrder, uploadCreative } from '../services/orders';
import type { SelectedDay, TimeRange } from '../services/orders';
import { API_URL } from '../services/api';

interface AddAdvancedSpaceModalProps {
  campaignId: number;
  existingSpaceIds: number[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type WizardStep = 'select' | 'dates' | 'schedule' | 'upload' | 'creating' | 'success';

const STEP_INDICES: Record<string, number> = { select: 0, dates: 1, schedule: 2, upload: 3 };
const TOTAL_STEPS = 4;

const PRICE_RANGES = [
  { labelKey: 'allPrices', min: 0, max: Infinity },
  { labelKey: 'priceUnder50', min: 0, max: 50 },
  { labelKey: 'price50to100', min: 50, max: 100 },
  { labelKey: 'price100to200', min: 100, max: 200 },
  { labelKey: 'price200plus', min: 200, max: Infinity },
];

/* ── tiny inline FilterDropdown (same as BookingFlow) ── */
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

function buildSelectedDays(
  selectedDayDates: Set<string>,
  selectedHours: Map<string, Set<string>>,
): SelectedDay[] {
  const result: SelectedDay[] = [];
  for (const date of selectedDayDates) {
    const hours = selectedHours.get(date);
    if (!hours || hours.size === 0) continue;
    const sortedHours = [...hours].sort();
    const ranges: TimeRange[] = [];
    let start = sortedHours[0];
    let prevEnd = incrementHour(start);
    for (let i = 1; i < sortedHours.length; i++) {
      const h = sortedHours[i];
      if (h === prevEnd) {
        prevEnd = incrementHour(h);
      } else {
        ranges.push({ start_time: start, end_time: prevEnd });
        start = h;
        prevEnd = incrementHour(h);
      }
    }
    ranges.push({ start_time: start, end_time: prevEnd });
    result.push({ date, time_ranges: ranges });
  }
  return result;
}

function incrementHour(hour: string): string {
  const h = parseInt(hour.slice(0, 2)) + 1;
  return `${String(h).padStart(2, '0')}:00`;
}

export default function AddAdvancedSpaceModal({
  campaignId,
  existingSpaceIds,
  open,
  onClose,
  onSuccess,
}: AddAdvancedSpaceModalProps) {
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

  const [step, setStep] = useState<WizardStep>('select');
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState<SpaceListItem | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [priceIdx, setPriceIdx] = useState(0);

  // Date step
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Schedule step
  const [availability, setAvailability] = useState<DayAvailability[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [selectedDayDates, setSelectedDayDates] = useState<Set<string>>(new Set());
  const [selectedHours, setSelectedHours] = useState<Map<string, Set<string>>>(new Map());

  // Upload step
  const [creativeFiles, setCreativeFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');

  const [error, setError] = useState('');

  // Reset when modal opens
  useEffect(() => {
    if (!open) return;
    setStep('select');
    setSearch('');
    setCategory('all');
    setPriceIdx(0);
    setSelectedSpace(null);
    setStartDate('');
    setEndDate('');
    setAvailability([]);
    setSelectedDayDates(new Set());
    setSelectedHours(new Map());
    setCreativeFiles([]);
    setNotes('');
    setError('');
    setSpacesLoading(true);
    setDataReady(false);
    getSpaces()
      .then(s => { setSpaces(s); setDataReady(true); })
      .catch(() => { setError('Failed to load spaces'); setDataReady(true); })
      .finally(() => setSpacesLoading(false));
  }, [open]);

  // Filter options
  const categoryOptions = useMemo(() => {
    const excludeSet = new Set(existingSpaceIds);
    const available = spaces.filter(s => !excludeSet.has(s.id));
    const types = new Set(available.map(s => s.space_type?.name).filter(Boolean));
    return [{ value: 'all', label: tc('allSpaceTypes') }, ...Array.from(types).sort().map(tp => ({ value: tp!, label: tp! }))];
  }, [spaces, existingSpaceIds, t]);

  const priceOptions = useMemo(() =>
    PRICE_RANGES.map((r, i) => ({ value: i, label: tc(r.labelKey) })),
  [t]);

  const filteredSpaces = useMemo(() => {
    const excludeSet = new Set(existingSpaceIds);
    return spaces.filter(s => {
      if (excludeSet.has(s.id)) return false;
      const q = search.toLowerCase().trim();
      if (q && !s.name.toLowerCase().includes(q) && !(s.city || '').toLowerCase().includes(q)) return false;
      if (category !== 'all' && s.space_type?.name !== category) return false;
      const range = PRICE_RANGES[priceIdx];
      if (range && s.price_per_day !== undefined) {
        if (s.price_per_day < range.min || s.price_per_day >= range.max) return false;
      }
      return true;
    });
  }, [spaces, existingSpaceIds, search, category, priceIdx]);

  const handleSelectSpace = (space: SpaceListItem) => {
    setSelectedSpace(space);
    setStep('dates');
  };

  const handleDatesNext = () => {
    if (!selectedSpace || !startDate || !endDate) return;
    setStep('schedule');
    setAvailLoading(true);
    getAvailability(selectedSpace.id, startDate, endDate)
      .then(data => {
        setAvailability(data);
        setSelectedDayDates(new Set());
        setSelectedHours(new Map());
      })
      .catch(() => setError(t('fetchAvailabilityFailed')))
      .finally(() => setAvailLoading(false));
  };

  const totalHourCount = useMemo(() => {
    let count = 0;
    selectedHours.forEach(s => (count += s.size));
    return count;
  }, [selectedHours]);

  const handleScheduleNext = () => {
    if (totalHourCount === 0) return;
    setStep('upload');
  };

  const handleSubmit = async () => {
    if (!selectedSpace) return;
    setStep('creating');
    setError('');
    try {
      const days = buildSelectedDays(selectedDayDates, selectedHours);
      const newOrder = await createOrder({
        space_id: selectedSpace.id,
        booking_type: 'long_term',
        start_date: startDate,
        end_date: endDate,
        selected_days: days,
        notes: notes || undefined,
        campaign_id: campaignId,
      });

      for (const file of creativeFiles) {
        try {
          await uploadCreative(newOrder.id, file);
        } catch {
          // Non-critical
        }
      }

      setStep('success');
    } catch (err: any) {
      setError(
        err.response?.data?.detail?.message ||
          err.response?.data?.detail ||
          'Failed to create order',
      );
      setStep('upload');
    }
  };

  const dismissSheet = () => {
    if (step !== 'creating') animatedClose();
  };

  const stepIndex = STEP_INDICES[step] ?? -1;

  const stepTitles: Record<string, string> = {
    select: t('addAdvancedSelectSpace'),
    schedule: t('addAdvancedSetSchedule'),
    upload: t('addAdvancedUpload'),
    creating: t('addAdvancedCreating'),
    success: t('addAdvancedSuccess'),
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
      {/* Step indicator */}
      {stepIndex >= 0 && (
        <div className="aasm-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className={`aasm-step${i <= stepIndex ? ' active' : ''}`} />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="bf-dup-sheet-content">
        {error && <div className="dup-error">{error}</div>}

        {/* {step !== 'select' && (
          <div className="bf-campaign-header">
            <h2>{stepTitles[step] || t('addAdvancedSpaceTitle')}</h2>
          </div>
        )} */}

        {step === 'select' && (
          <>
            <div className="aasm-sticky-header">
              <div className="bf-campaign-header"><h2>{stepTitles['select']}</h2></div>
              <p className="aasm-subtitle">{t('addAdvancedSelectSpaceDesc')}</p>
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
            {spacesLoading ? (
              <div className="dup-loading"><Loader variant="inline" /></div>
            ) : filteredSpaces.length === 0 ? (
              <div className="dup-empty">{t('addAdvancedNoSpaces')}</div>
            ) : (
              <div className="dup-space-grid aasm-space-grid-tall">
                {filteredSpaces.map(space => (
                  <button key={space.id} className="dup-space-card" onClick={() => handleSelectSpace(space)}>
                    {space.first_image ? <img className="dup-space-card-img" src={`${API_URL}${space.first_image}`} alt={space.name} /> : <div style={{ width: '100%', height: 80, background: '#f3f4f6' }} />}
                    <div className="dup-space-card-body">
                      <span className="dup-space-card-name">{space.name}</span>
                      <span className="dup-space-card-meta">{[space.city, space.environment].filter(Boolean).join(' · ')}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 'dates' && (
          <>
            {/* <p className="aasm-subtitle">{t('addAdvancedSetDatesDesc')}</p> */}
            <DateRangePicker startDate={startDate} endDate={endDate} onStartDateChange={setStartDate} onEndDateChange={setEndDate} />
          </>
        )}

        {step === 'schedule' && (
          <>
            {/* <p className="aasm-subtitle">{t('addAdvancedSetScheduleDesc')}</p> */}
            <ScheduleSelector
              availability={availability} selectedDayDates={selectedDayDates} selectedHours={selectedHours}
              onDayDatesChange={setSelectedDayDates} onHoursChange={setSelectedHours} loading={availLoading}
              summaryNode={totalHourCount > 0 ? <div className="bf-selection-summary">{t('selectionSummary', { days: selectedDayDates.size, hours: totalHourCount })}</div> : undefined}
            />
          </>
        )}

        {step === 'upload' && (
          <>
            {/* <p className="aasm-subtitle">{t('addAdvancedUploadDesc')}</p> */}
            <CreativeUploader creativeFiles={creativeFiles} onFilesChange={setCreativeFiles} notes={notes} onNotesChange={setNotes} />
          </>
        )}

        {step === 'creating' && <div className="dup-loading"><Loader variant="inline" /><p>{t('addAdvancedCreating')}</p></div>}

        {step === 'success' && (
          <div className="dup-success">
            <div className="dup-success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="40" height="40"><path d="M20 6 9 17l-5-5" /></svg></div>
            <p>{t('addAdvancedSuccessDesc')}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      {step !== 'creating' && step !== 'select' && (
        <div className="bf-dup-sheet-bottom">
          {(step === 'dates' || step === 'schedule' || step === 'upload') && (
            <button className="dup-btn dup-btn-back" onClick={() => setStep(step === 'dates' ? 'select' : step === 'schedule' ? 'dates' : 'schedule')}>{t('back')}</button>
          )}
          {step === 'dates' && <button className="dup-btn dup-btn-primary" disabled={!startDate || !endDate} onClick={handleDatesNext}>{t('continueBtn')}</button>}
          {step === 'schedule' && <button className="dup-btn dup-btn-primary" disabled={totalHourCount === 0} onClick={handleScheduleNext}>{t('continueBtn')}</button>}
          {step === 'upload' && <button className="dup-btn dup-btn-primary" disabled={creativeFiles.length === 0} onClick={handleSubmit}>{t('sendBookingRequest')}</button>}
          {step === 'success' && <button className="dup-btn dup-btn-primary" onClick={onSuccess}>{t('viewMyOrders')}</button>}
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
        title={stepTitles[step] || t('addAdvancedSpaceTitle')}
        dismissible={step !== 'creating'}
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
