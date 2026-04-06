import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DayAvailability, HourSlotInfo } from '../services/spaces';
import Loader from './Loader';

/** Generate hourly slots from operating hours using API's hour_slots data. */
export function generateHourSlots(day: DayAvailability): { hour: string; endHour: string; available: boolean; partial: boolean; bookedCount: number; maxSlots: number }[] {
  if (!day.operating_hours) return [];
  const oh = day.operating_hours;
  const startH = parseInt(oh.start_time.slice(0, 2));
  const endH = parseInt(oh.end_time.slice(0, 2));
  const slotMap = new Map<string, HourSlotInfo>();
  for (const hs of (day.hour_slots || [])) slotMap.set(hs.hour, hs);

  const slots: { hour: string; endHour: string; available: boolean; partial: boolean; bookedCount: number; maxSlots: number }[] = [];
  for (let h = startH; h < endH; h++) {
    const hStr = `${String(h).padStart(2, '0')}:00`;
    const hEnd = `${String(h + 1).padStart(2, '0')}:00`;
    const info = slotMap.get(hStr);
    const bookedCount = info?.booked_count ?? 0;
    const maxSlots = info?.max_slots ?? 6;
    const full = bookedCount >= maxSlots;
    const partial = bookedCount > 0 && !full;
    slots.push({ hour: hStr, endHour: hEnd, available: !full, partial, bookedCount, maxSlots });
  }
  return slots;
}

function isHourAvailableOnDate(day: DayAvailability, hour: string): boolean {
  const daySlots = generateHourSlots(day);
  const slot = daySlots.find(s => s.hour === hour);
  return slot ? slot.available : false;
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


interface ScheduleSelectorProps {
  availability: DayAvailability[];
  selectedDayDates: Set<string>;
  selectedHours: Map<string, Set<string>>;
  onDayDatesChange: (days: Set<string>) => void;
  onHoursChange: (hours: Map<string, Set<string>>) => void;
  loading?: boolean;
  summaryNode?: React.ReactNode;
  hideHeader?: boolean;
  preferenceMode?: boolean;
}

export default function ScheduleSelector({
  availability,
  selectedDayDates,
  selectedHours,
  onDayDatesChange,
  onHoursChange,
  loading,
  summaryNode,
  hideHeader,
  preferenceMode,
}: ScheduleSelectorProps) {
  const { t, i18n } = useTranslation('orders');
  const [activePresets, setActivePresets] = useState<Set<string>>(new Set());

  const fullDayNames: string[] = t('dayNames', { ns: 'common', returnObjects: true }) as string[];
  const isHebrew = i18n.language === 'he';
  const translatedDayNames = fullDayNames.map(d => (!isHebrew && d.length > 3) ? d.slice(0, 3) : d);

  const isAvailable = (day: DayAvailability, hour: string): boolean => {
    if (preferenceMode) return true;
    return isHourAvailableOnDate(day, hour);
  };
  const hasWindows = (day: DayAvailability): boolean => {
    if (preferenceMode) return !!day.operating_hours;
    return day.available_windows.length > 0 || !!day.operating_hours;
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
    const withAvail = days.filter(d => hasWindows(d));
    if (withAvail.length === 0) return 'none';
    const selectedCount = withAvail.filter(d => selectedDayDates.has(d.date)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === withAvail.length) return 'all';
    return 'partial';
  };

  const toggleWeekdaySegment = (dow: number, segmentHours: string[]) => {
    const allDaysOfWeekday = (availByWeekday.get(dow) || []).filter(d => hasWindows(d));
    if (allDaysOfWeekday.length === 0) return;

    let effectiveDayDates = selectedDayDates;
    let effectiveHours = selectedHours;
    const selectedDays = allDaysOfWeekday.filter(d => selectedDayDates.has(d.date));
    if (selectedDays.length === 0) {
      effectiveDayDates = new Set(selectedDayDates);
      for (const d of allDaysOfWeekday) effectiveDayDates.add(d.date);
      effectiveHours = new Map(selectedHours);
      onDayDatesChange(effectiveDayDates);
    }

    const daysOfWeekday = allDaysOfWeekday.filter(d => effectiveDayDates.has(d.date));
    if (daysOfWeekday.length === 0) return;

    const isSelected = daysOfWeekday.every(d => {
      const h = effectiveHours.get(d.date);
      return segmentHours.every(sh => h?.has(sh));
    });

    // Also check if partially selected (some hours already picked)
    const isPartial = !isSelected && daysOfWeekday.some(d => {
      const h = effectiveHours.get(d.date);
      return segmentHours.some(sh => h?.has(sh));
    });

    // If fully or partially selected → remove; otherwise → add
    const shouldRemove = isSelected || isPartial;

    const nextMap = new Map(effectiveHours);
    for (const day of daysOfWeekday) {
      const daySet = new Set(nextMap.get(day.date) || []);
      for (const sh of segmentHours) {
        if (shouldRemove) daySet.delete(sh);
        else if (isAvailable(day, sh)) daySet.add(sh);
      }
      nextMap.set(day.date, daySet);
    }
    onHoursChange(nextMap);

    // Auto-detect which presets are fully covered by manual selection
    syncPresetsFromSelection(effectiveDayDates, nextMap);
  };

  /** Check selected hours against segment ranges and sync activePresets */
  const syncPresetsFromSelection = (dayDates: Set<string>, hours: Map<string, Set<string>>) => {
    const segmentDefs = [
      { preset: 'mornings',   startH: 5,  endH: 12 },
      { preset: 'afternoons', startH: 12, endH: 16 },
      { preset: 'evenings',   startH: 16, endH: 29 },
    ];

    const daysWithAvail = availability.filter(d => hasWindows(d));
    if (daysWithAvail.length === 0) return;

    const matched = new Set<string>();
    for (const seg of segmentDefs) {
      const segFullyCovered = daysWithAvail.every(day => {
        if (!dayDates.has(day.date)) return false;
        const slots = generateHourSlots(day);
        const segAvailHours = slots
          .filter(s => preferenceMode ? true : s.available)
          .map(s => s.hour)
          .filter(h => { const hh = parseInt(h); return hh >= seg.startH && hh < seg.endH; });
        if (segAvailHours.length === 0) return true; // no hours in this segment for this day
        const sel = hours.get(day.date);
        return segAvailHours.every(h => sel?.has(h));
      });
      if (segFullyCovered) matched.add(seg.preset);
    }

    // If all three → upgrade to all_day
    if (matched.size === 3) {
      setActivePresets(new Set(['all_day']));
    } else {
      setActivePresets(matched);
    }
  };

  function getWeekdaySegmentsForDisplay(dow: number) {
    const allDaysOfWeekday = availByWeekday.get(dow) || [];
    const days = allDaysOfWeekday.filter(d => hasWindows(d));
    if (days.length === 0) return [];
    const firstDay = days[0];
    if (!firstDay.operating_hours) return [];
    const segments = getClippedSegments(firstDay.operating_hours);
    const selectedDays = days.filter(d => selectedDayDates.has(d.date));

    return segments.map(seg => {
      const allLocked = preferenceMode ? false : seg.hours.every(hour => days.every(d => !isHourAvailableOnDate(d, hour)));

      const isSelected = !allLocked && selectedDays.length > 0 && selectedDays.every(d => {
        const h = selectedHours.get(d.date);
        return seg.hours.every(sh => {
          if (!isAvailable(d, sh)) return true;
          return h?.has(sh) ?? false;
        });
      });

      const isPartial = !allLocked && !isSelected && selectedDays.length > 0 && selectedDays.some(d => {
        const h = selectedHours.get(d.date);
        return seg.hours.some(sh => h?.has(sh));
      });

      // datesTotal = ALL dates of this weekday in the period (including fully booked ones)
      // datesAvailable = only those where at least one hour in this segment has an open slot
      const datesAvailable = days.filter(d => seg.hours.some(hour => isAvailable(d, hour))).length;
      const datesTotal = allDaysOfWeekday.length;

      const firstDaySlots = generateHourSlots(firstDay);
      let slotMax = 6;
      let slotAvail = 6;
      for (const hour of seg.hours) {
        const slot = firstDaySlots.find(s => s.hour === hour);
        if (slot) {
          slotMax = slot.maxSlots;
          slotAvail = slot.maxSlots - slot.bookedCount;
          break;
        }
      }

      return { ...seg, locked: allLocked, selected: isSelected, partial: isPartial, datesAvailable, datesTotal, slotAvail, slotMax };
    });
  }

  const headerSegments = (() => {
    let globalStart = 24;
    let globalEnd = 0;
    for (const [, days] of availByWeekday) {
      for (const d of days) {
        if (!d.operating_hours || !hasWindows(d)) continue;
        const s = parseInt(d.operating_hours.start_time.slice(0, 2));
        const e = parseInt(d.operating_hours.end_time.slice(0, 2));
        if (s < globalStart) globalStart = s;
        if (e > globalEnd) globalEnd = e;
      }
    }
    if (globalStart >= globalEnd) return [];
    return getClippedSegments({ start_time: `${String(globalStart).padStart(2, '0')}:00`, end_time: `${String(globalEnd).padStart(2, '0')}:00` });
  })();

  const applyPreset = (preset: string) => {
    const timePresets = ['mornings', 'afternoons', 'evenings'];

    let next: Set<string>;
    if (preset === 'all_day') {
      // All Day is standalone — toggle it, clear time presets
      next = activePresets.has('all_day') ? new Set() : new Set(['all_day']);
    } else {
      // Time presets are multi-select; clicking one toggles it
      next = new Set(activePresets);
      next.delete('all_day'); // clear All Day if a time preset is picked
      if (next.has(preset)) {
        next.delete(preset);
      } else {
        next.add(preset);
      }
      // If all three time presets are selected, upgrade to All Day
      if (timePresets.every(p => next.has(p))) {
        next = new Set(['all_day']);
      }
    }

    setActivePresets(next);

    if (next.size === 0) {
      onDayDatesChange(new Set<string>());
      onHoursChange(new Map<string, Set<string>>());
      return;
    }

    const nextDayDates = new Set<string>();
    const nextHours = new Map<string, Set<string>>();

    for (const day of availability) {
      if (!hasWindows(day)) continue;
      const slots = generateHourSlots(day);
      const availableHourStrs = preferenceMode ? slots.map(s => s.hour) : slots.filter(s => s.available).map(s => s.hour);
      if (availableHourStrs.length === 0) continue;

      if (next.has('all_day')) {
        nextDayDates.add(day.date);
        nextHours.set(day.date, new Set(availableHourStrs));
      } else {
        const matched = availableHourStrs.filter(h => {
          const hh = parseInt(h);
          if (next.has('mornings') && hh >= 5 && hh < 12) return true;
          if (next.has('afternoons') && hh >= 12 && hh < 16) return true;
          if (next.has('evenings') && hh >= 16) return true;
          return false;
        });
        if (matched.length > 0) {
          nextDayDates.add(day.date);
          nextHours.set(day.date, new Set(matched));
        }
      }
    }
    onDayDatesChange(nextDayDates);
    onHoursChange(nextHours);
  };

  let totalHourCount = 0;
  selectedHours.forEach(s => totalHourCount += s.size);
  const ltHasSchedule = totalHourCount > 0;

  if (loading && availability.length === 0) {
    return (
      <div className="bf-section bf-animate-in">
        {!hideHeader && (
          <>
            <h2 className="bf-step-title">{t('setYourSchedule')}</h2>
            <p className="bf-step-desc">{t('choosePresetOrCustomize')}</p>
          </>
        )}
        <Loader variant="inline" />
      </div>
    );
  }

  if (availability.length === 0) {
    return (
      <div className="bf-section bf-animate-in">
        {!hideHeader && (
          <>
            <h2 className="bf-step-title">{t('setYourSchedule')}</h2>
            <p className="bf-step-desc">{t('choosePresetOrCustomize')}</p>
          </>
        )}
        <div className="bf-empty-state">
          <div className="bf-empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </div>
          <h3 className="bf-empty-state-title">{t('noAvailabilityTitle')}</h3>
          <p className="bf-empty-state-desc">{t('noAvailabilityDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bf-section bf-animate-in">
      {!hideHeader && (
        <>
          <h2 className="bf-step-title">{t('setYourSchedule')}</h2>
          <p className="bf-step-desc">{t('choosePresetOrCustomize')}</p>
        </>
      )}

      <div className={`bf-schedule-content${loading ? ' bf-schedule-loading' : ''}`}>
        {loading && <div className="bf-schedule-overlay"><Loader variant="inline" /></div>}

        {/* Segmented control: Custom / All Day */}
        <div className="sc-seg-wrap">
          <div className={`sc-seg-control${activePresets.has('all_day') ? ' sc-seg-allday' : ''}`}>
            <div className="sc-seg-slider" />
            <button
              type="button"
              className={`sc-seg-btn${!activePresets.has('all_day') ? ' sc-seg-btn-active' : ''}`}
              onClick={() => { if (activePresets.has('all_day')) applyPreset('all_day'); }}
            >
              {t('customSchedule')}
            </button>
            <button
              type="button"
              className={`sc-seg-btn${activePresets.has('all_day') ? ' sc-seg-btn-active' : ''}`}
              onClick={() => { if (!activePresets.has('all_day')) applyPreset('all_day'); }}
            >
              {activePresets.has('all_day') && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {t('presetAllDay')}
            </button>
          </div>
        </div>

        {/* Card-based schedule */}
        <div className="sc-container">
          {/* Column headers — clickable images act as presets */}
          <div className="sc-header">
            <div className="sc-header-day" />
            {headerSegments.map(seg => {
              const presetKey = seg.key === 'morning' ? 'mornings' : seg.key === 'afternoon' ? 'afternoons' : 'evenings';
              const isActive = activePresets.has(presetKey) || activePresets.has('all_day');
              const imgSrc = seg.icon === 'morning' ? '/morning.png' : seg.icon === 'afternoon' ? '/afternoon.png' : '/evening.png';
              return (
                <div
                  key={seg.key}
                  className={`sc-header-seg sc-header-seg-clickable${isActive ? ' sc-header-seg-active' : ''}`}
                  onClick={() => applyPreset(presetKey)}
                >
                  <span className="bf-seg-header-icon">
                    <img src={imgSrc} alt={t(seg.label)} />
                  </span>
                  <span className="sc-header-label">{t(seg.label)}</span>
                </div>
              );
            })}
          </div>

          {/* Day rows — only show weekdays that exist in the availability period */}
          <div className="sc-rows">
            {[0, 1, 2, 3, 4, 5, 6].filter(dow => {
              const days = availByWeekday.get(dow) || [];
              return days.length > 0;
            }).map(dow => {
              const days = availByWeekday.get(dow) || [];
              const withAvail = days.filter(d => hasWindows(d));
              const hasAvailability = withAvail.length > 0;
              const rowSegments = hasAvailability ? getWeekdaySegmentsForDisplay(dow) : [];
              const rowSegmentKeys = new Set(rowSegments.map(s => s.key));

              return (
                <div
                  key={dow}
                  className={[
                    'sc-row',
                    !hasAvailability ? 'sc-row-disabled' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {/* Day name */}
                  <div className="sc-day-name">{translatedDayNames[dow]}</div>

                  {/* Segment pills */}
                  {headerSegments.map(hSeg => {
                    const rowSeg = rowSegments.find(rs => rs.key === hSeg.key);

                    // No availability or segment doesn't exist for this day
                    if (!hasAvailability || !rowSegmentKeys.has(hSeg.key)) {
                      return (
                        <div key={hSeg.key} className="sc-pill-cell">
                          <button type="button" className="sc-pill sc-pill-unavailable" disabled>
                            {t('notAvailable', { defaultValue: 'Not Available' })}
                          </button>
                        </div>
                      );
                    }

                    const seg = rowSeg!;
                    const timeText = `${String(seg.clippedStart).padStart(2, '0')}:00-${String(seg.clippedEnd).padStart(2, '0')}:00`;
                    const isActive = seg.selected || seg.partial;
                    // Unavailable percentage — bar shows how much is taken, not available
                    const unavailPct = seg.datesTotal > 0 ? Math.round(((seg.datesTotal - seg.datesAvailable) / seg.datesTotal) * 100) : 0;

                    return (
                      <div key={hSeg.key} className="sc-pill-cell">
                        <button
                          type="button"
                          className={[
                            'sc-pill',
                            seg.locked ? 'sc-pill-locked' : '',
                            isActive ? 'sc-pill-active' : '',
                          ].filter(Boolean).join(' ')}
                          disabled={seg.locked}
                          onClick={() => { if (!seg.locked) toggleWeekdaySegment(dow, seg.hours); }}
                        >
                          <span className="sc-pill-time" dir="ltr">{timeText}</span>
                          {!preferenceMode && (seg.locked ? (
                            <span className="sc-pill-full-label">{t('full')}</span>
                          ) : (
                            <span className="sc-pill-ratio">
                              {seg.datesAvailable === seg.datesTotal
                                ? t('allDatesAvailable', { count: seg.datesTotal })
                                : t('availableOfTotal', { available: seg.datesAvailable, total: seg.datesTotal })}
                            </span>
                          ))}
                        </button>
                        {!preferenceMode && (seg.locked ? (
                          <span className="sc-pill-bar sc-pill-bar-full">
                            <span className="sc-pill-bar-fill" style={{ width: '100%' }} />
                          </span>
                        ) : unavailPct > 0 ? (
                          <span className="sc-pill-bar">
                            <span className={`sc-pill-bar-fill${isActive ? ' sc-pill-bar-active' : ''}`} style={{ width: `${unavailPct}%` }} />
                          </span>
                        ) : null)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {ltHasSchedule && summaryNode}
      </div>
    </div>
  );
}
